import {
  getAISession,
  getGithubSession,
  getJiraSession,
  getVercelSession,
} from "@/lib/session";
import { DEFAULT_MODELS, hasServerKey } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function GET() {
  const [gh, jira, vercel, ai] = await Promise.all([
    getGithubSession(),
    getJiraSession(),
    getVercelSession(),
    getAISession(),
  ]);

  return Response.json({
    serverAi: hasServerKey(),
    byokAi: ai ? { provider: ai.provider, model: ai.model ?? DEFAULT_MODELS[ai.provider] } : null,
    oauthConfigured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.SESSION_SECRET),
    github: gh ? { login: gh.login, avatarUrl: gh.avatarUrl } : null,
    jira: jira ? { site: jira.site, projectKey: jira.projectKey } : null,
    vercel: Boolean(vercel),
  });
}
