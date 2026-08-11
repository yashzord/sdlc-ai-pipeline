import { setVercelSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return Response.redirect(`${url.origin}/?vercel_error=missing_code`, 302);
  }

  const res = await fetch("https://api.vercel.com/v2/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.VERCEL_CLIENT_ID ?? "",
      client_secret: process.env.VERCEL_CLIENT_SECRET ?? "",
      code,
      redirect_uri: `${url.origin}/api/vercel/oauth/callback`,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  const token: string | undefined = data.access_token;
  if (!res.ok || !token) {
    return Response.redirect(`${url.origin}/?vercel_error=exchange_failed`, 302);
  }

  await setVercelSession({ token, teamId: data.team_id ?? undefined });

  // Vercel appends a `next` URL to return the user to their dashboard flow;
  // we send them back to the app instead.
  return Response.redirect(`${url.origin}/`, 302);
}
