// Jira Cloud client supporting both auth modes:
// - basic: user-supplied email + API token against their site
// - oauth: Atlassian 3LO tokens against api.atlassian.com, with auto-refresh
import { setJiraSession, type JiraOAuthSession, type JiraSession } from "./session";

export class JiraError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

function isOAuth(session: JiraSession): session is JiraOAuthSession {
  return session.kind === "oauth";
}

export function jiraSiteUrl(session: JiraSession): string {
  return isOAuth(session) ? session.siteUrl : session.site;
}

/* ------------------------------- OAuth (3LO) ------------------------------- */

export function jiraOAuthConfigured(): boolean {
  return Boolean(process.env.JIRA_CLIENT_ID && process.env.JIRA_CLIENT_SECRET);
}

export async function exchangeJiraCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const res = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: process.env.JIRA_CLIENT_ID,
      client_secret: process.env.JIRA_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Atlassian token exchange failed (${res.status})`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? "",
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

export async function fetchJiraCloud(
  accessToken: string
): Promise<{ cloudId: string; siteUrl: string }> {
  const res = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const sites = await res.json().catch(() => []);
  if (!res.ok || !Array.isArray(sites) || sites.length === 0) {
    throw new Error("No accessible Jira sites for this Atlassian account");
  }
  return { cloudId: sites[0].id, siteUrl: sites[0].url };
}

async function refreshOAuth(session: JiraOAuthSession): Promise<JiraOAuthSession> {
  const res = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: process.env.JIRA_CLIENT_ID,
      client_secret: process.env.JIRA_CLIENT_SECRET,
      refresh_token: session.refreshToken,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new JiraError("Jira session expired — reconnect Jira in the setup panel", 401);
  }
  const updated: JiraOAuthSession = {
    ...session,
    accessToken: data.access_token,
    // Atlassian rotates refresh tokens — always keep the newest one.
    refreshToken: data.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  await setJiraSession(updated);
  return updated;
}

/* --------------------------------- requests -------------------------------- */

function requestUrl(session: JiraSession, path: string): string {
  return isOAuth(session)
    ? `https://api.atlassian.com/ex/jira/${session.cloudId}${path}`
    : `${session.site}${path}`;
}

function authHeader(session: JiraSession): string {
  return isOAuth(session)
    ? `Bearer ${session.accessToken}`
    : `Basic ${Buffer.from(`${session.email}:${session.apiToken}`).toString("base64")}`;
}

async function jira<T>(
  session: JiraSession,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  let current = session;
  if (isOAuth(current) && current.expiresAt < Date.now() + 60_000) {
    current = await refreshOAuth(current);
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(requestUrl(current, path), {
      method,
      headers: {
        Authorization: authHeader(current),
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 && isOAuth(current) && attempt === 0) {
      current = await refreshOAuth(current);
      continue;
    }
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail =
        (Array.isArray(data.errorMessages) && data.errorMessages.join("; ")) ||
        JSON.stringify(data.errors ?? {}).slice(0, 200) ||
        "unknown error";
      throw new JiraError(`Jira ${method} ${path} → ${res.status}: ${detail}`, res.status);
    }
    return data as T;
  }
  throw new JiraError("Jira request failed after token refresh", 401);
}

/* ---------------------------------- API ------------------------------------ */

export async function validateJira(session: JiraSession): Promise<{ displayName: string }> {
  return jira<{ displayName: string }>(session, "GET", "/rest/api/3/myself");
}

export async function listJiraProjects(
  session: JiraSession
): Promise<Array<{ key: string; name: string }>> {
  const data = await jira<{ values: Array<{ key: string; name: string }> }>(
    session,
    "GET",
    "/rest/api/3/project/search?maxResults=50&orderBy=lastIssueUpdatedTime"
  );
  return data.values.map((p) => ({ key: p.key, name: p.name }));
}

// Minimal markdown → Atlassian Document Format. Handles headings, bullets,
// numbered lists, and paragraphs — enough for AI-generated docs.
export function markdownToAdf(markdown: string) {
  const content: object[] = [];
  const lines = markdown.split("\n");
  let bullets: string[] = [];
  let numbered: string[] = [];

  const text = (t: string) => [{ type: "text", text: t || " " }];
  const flush = () => {
    if (bullets.length) {
      content.push({
        type: "bulletList",
        content: bullets.map((b) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: text(b) }],
        })),
      });
      bullets = [];
    }
    if (numbered.length) {
      content.push({
        type: "orderedList",
        content: numbered.map((b) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: text(b) }],
        })),
      });
      numbered = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\*\*/g, "").replace(/`/g, "");
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const num = line.match(/^\s*\d+\.\s+(.*)$/);
    if (heading) {
      flush();
      content.push({
        type: "heading",
        attrs: { level: Math.min(heading[1].length + 1, 5) },
        content: text(heading[2]),
      });
    } else if (bullet) {
      if (numbered.length) flush();
      bullets.push(bullet[1]);
    } else if (num) {
      if (bullets.length) flush();
      numbered.push(num[1]);
    } else if (line.trim()) {
      flush();
      content.push({ type: "paragraph", content: text(line.trim()) });
    }
  }
  flush();
  if (!content.length) content.push({ type: "paragraph", content: text(markdown.slice(0, 500)) });
  return { type: "doc", version: 1, content };
}

export async function createJiraIssue(
  session: JiraSession,
  issueType: "Epic" | "Story" | "Task",
  summary: string,
  descriptionMarkdown: string,
  parentKey?: string
): Promise<{ key: string; url: string }> {
  if (!session.projectKey) throw new Error("No Jira project selected");
  const fields: Record<string, unknown> = {
    project: { key: session.projectKey },
    issuetype: { name: issueType },
    summary: summary.slice(0, 250),
    description: markdownToAdf(descriptionMarkdown),
  };
  if (parentKey) fields.parent = { key: parentKey };

  try {
    const data = await jira<{ key: string }>(session, "POST", "/rest/api/3/issue", { fields });
    return { key: data.key, url: `${jiraSiteUrl(session)}/browse/${data.key}` };
  } catch (err) {
    // Company-managed projects may reject `parent` for stories under epics;
    // retry without the link rather than failing the stage.
    if (parentKey && err instanceof JiraError && err.status === 400) {
      delete fields.parent;
      const data = await jira<{ key: string }>(session, "POST", "/rest/api/3/issue", { fields });
      return { key: data.key, url: `${jiraSiteUrl(session)}/browse/${data.key}` };
    }
    throw err;
  }
}

export async function transitionJiraIssue(
  session: JiraSession,
  issueKey: string,
  targetNameIncludes: string[]
): Promise<boolean> {
  const data = await jira<{ transitions: Array<{ id: string; name: string }> }>(
    session,
    "GET",
    `/rest/api/3/issue/${issueKey}/transitions`
  );
  const target = data.transitions.find((t) =>
    targetNameIncludes.some((n) => t.name.toLowerCase().includes(n))
  );
  if (!target) return false;
  await jira(session, "POST", `/rest/api/3/issue/${issueKey}/transitions`, {
    transition: { id: target.id },
  });
  return true;
}
