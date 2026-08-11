import { cookies } from "next/headers";
import { setJiraSession } from "@/lib/session";
import { exchangeJiraCode, fetchJiraCloud } from "@/lib/jira";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const expectedState = jar.get("sdlc_jira_state")?.value;
  jar.delete("sdlc_jira_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    return Response.redirect(`${url.origin}/?jira_error=state_mismatch`, 302);
  }

  try {
    const tokens = await exchangeJiraCode(code, `${url.origin}/api/jira/oauth/callback`);
    const cloud = await fetchJiraCloud(tokens.accessToken);
    await setJiraSession({
      kind: "oauth",
      cloudId: cloud.cloudId,
      siteUrl: cloud.siteUrl,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });
    return Response.redirect(`${url.origin}/?jira_connected=1`, 302);
  } catch {
    return Response.redirect(`${url.origin}/?jira_error=exchange_failed`, 302);
  }
}
