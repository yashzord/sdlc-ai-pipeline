import { cookies } from "next/headers";
import { setGithubSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const expectedState = jar.get("sdlc_oauth_state")?.value;
  jar.delete("sdlc_oauth_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    return Response.redirect(`${url.origin}/?auth_error=state_mismatch`, 302);
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/api/auth/callback`,
    }),
  });
  const tokenData = await tokenRes.json();
  const token: string | undefined = tokenData.access_token;
  if (!token) {
    return Response.redirect(`${url.origin}/?auth_error=token_exchange_failed`, 302);
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!userRes.ok) {
    return Response.redirect(`${url.origin}/?auth_error=user_fetch_failed`, 302);
  }
  const user = await userRes.json();

  await setGithubSession({
    token,
    login: user.login,
    avatarUrl: user.avatar_url ?? "",
  });

  return Response.redirect(`${url.origin}/`, 302);
}
