import { getGithubSession, getJiraSession } from "@/lib/session";
import { listJiraProjects } from "@/lib/jira";

export const dynamic = "force-dynamic";

export async function GET() {
  const gh = await getGithubSession();
  if (!gh) return Response.json({ error: "Not signed in with GitHub" }, { status: 401 });
  const jira = await getJiraSession();
  if (!jira) return Response.json({ error: "Jira is not connected" }, { status: 400 });

  try {
    const projects = await listJiraProjects(jira);
    return Response.json({ projects });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message.slice(0, 200) }, { status: 502 });
  }
}
