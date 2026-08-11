import { getGithubSession, getJiraSession, setJiraSession, clearSession } from "@/lib/session";
import { validateJira } from "@/lib/jira";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gh = await getGithubSession();
  if (!gh) return Response.json({ error: "Not signed in with GitHub" }, { status: 401 });

  let body: { site?: string; email?: string; apiToken?: string; projectKey?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const site = (body.site ?? "").trim().replace(/\/+$/, "");
  const email = (body.email ?? "").trim();
  const apiToken = (body.apiToken ?? "").trim();
  const projectKey = (body.projectKey ?? "").trim().toUpperCase();

  if (!/^https:\/\/[a-z0-9-]+\.atlassian\.net$/i.test(site)) {
    return Response.json(
      { error: "Site must look like https://your-team.atlassian.net" },
      { status: 400 }
    );
  }
  if (!email || !apiToken || !/^[A-Z][A-Z0-9]{1,9}$/.test(projectKey)) {
    return Response.json(
      { error: "Email, API token, and a valid project key (e.g. SDLC) are required" },
      { status: 400 }
    );
  }

  const session = { kind: "basic" as const, site, email, apiToken, projectKey };
  try {
    const me = await validateJira(session);
    await setJiraSession(session);
    return Response.json({ connected: true, displayName: me.displayName, site, projectKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Jira validation failed: ${message.slice(0, 200)}` },
      { status: 401 }
    );
  }
}

// Set (or change) the target project — used after the OAuth connect flow.
export async function PATCH(request: Request) {
  const gh = await getGithubSession();
  if (!gh) return Response.json({ error: "Not signed in with GitHub" }, { status: 401 });
  const session = await getJiraSession();
  if (!session) return Response.json({ error: "Jira is not connected" }, { status: 400 });

  let body: { projectKey?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const projectKey = (body.projectKey ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(projectKey)) {
    return Response.json({ error: "Invalid project key" }, { status: 400 });
  }

  await setJiraSession({ ...session, projectKey });
  return Response.json({ ok: true, projectKey });
}

export async function DELETE() {
  await clearSession(["jira"]);
  return Response.json({ ok: true });
}
