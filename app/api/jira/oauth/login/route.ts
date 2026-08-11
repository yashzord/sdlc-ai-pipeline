import { cookies } from "next/headers";
import { jiraOAuthConfigured } from "@/lib/jira";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!jiraOAuthConfigured()) {
    return Response.json(
      { error: "Jira OAuth is not configured on this deployment" },
      { status: 503 }
    );
  }

  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set("sdlc_jira_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const origin = new URL(request.url).origin;
  const authorize = new URL("https://auth.atlassian.com/authorize");
  authorize.searchParams.set("audience", "api.atlassian.com");
  authorize.searchParams.set("client_id", process.env.JIRA_CLIENT_ID!);
  authorize.searchParams.set(
    "scope",
    "read:jira-work write:jira-work read:me offline_access"
  );
  authorize.searchParams.set("redirect_uri", `${origin}/api/jira/oauth/callback`);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("prompt", "consent");

  return Response.redirect(authorize.toString(), 302);
}
