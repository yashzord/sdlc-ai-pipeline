// Jira Cloud REST v3 client using the user's email + API token (basic auth).
import type { JiraSession } from "./session";

export class JiraError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

function authHeader(session: JiraSession): string {
  return `Basic ${Buffer.from(`${session.email}:${session.apiToken}`).toString("base64")}`;
}

async function jira<T>(
  session: JiraSession,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${session.site}${path}`, {
    method,
    headers: {
      Authorization: authHeader(session),
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
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

export async function validateJira(session: JiraSession): Promise<{ displayName: string }> {
  return jira<{ displayName: string }>(session, "GET", "/rest/api/3/myself");
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
  const fields: Record<string, unknown> = {
    project: { key: session.projectKey },
    issuetype: { name: issueType },
    summary: summary.slice(0, 250),
    description: markdownToAdf(descriptionMarkdown),
  };
  if (parentKey) fields.parent = { key: parentKey };

  try {
    const data = await jira<{ key: string }>(session, "POST", "/rest/api/3/issue", { fields });
    return { key: data.key, url: `${session.site}/browse/${data.key}` };
  } catch (err) {
    // Company-managed projects may reject `parent` for stories under epics;
    // retry without the link rather than failing the stage.
    if (parentKey && err instanceof JiraError && err.status === 400) {
      delete fields.parent;
      const data = await jira<{ key: string }>(session, "POST", "/rest/api/3/issue", { fields });
      return { key: data.key, url: `${session.site}/browse/${data.key}` };
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
