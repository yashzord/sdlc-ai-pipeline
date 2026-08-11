import { getGithubSession, getJiraSession, getWorkspace } from "@/lib/session";
import { hasLiveKey } from "@/lib/gemini";

export const dynamic = "force-dynamic";

export async function GET() {
  const [gh, jira, workspace] = await Promise.all([
    getGithubSession(),
    getJiraSession(),
    getWorkspace(),
  ]);

  return Response.json({
    ai: hasLiveKey(),
    oauthConfigured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.SESSION_SECRET),
    github: gh ? { login: gh.login, avatarUrl: gh.avatarUrl } : null,
    jira: jira ? { site: jira.site, projectKey: jira.projectKey } : null,
    workspace,
  });
}
