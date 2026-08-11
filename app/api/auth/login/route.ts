import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return Response.json(
      { error: "GITHUB_CLIENT_ID is not configured on the server" },
      { status: 503 }
    );
  }

  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set("sdlc_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const origin = new URL(request.url).origin;
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", `${origin}/api/auth/callback`);
  // `workflow` is required on top of `repo` to commit .github/workflows files
  authorize.searchParams.set("scope", "repo workflow");
  authorize.searchParams.set("state", state);

  return Response.redirect(authorize.toString(), 302);
}
