import { getGithubSession, setVercelSession, clearSession } from "@/lib/session";
import { validateVercel } from "@/lib/vercel";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gh = await getGithubSession();
  if (!gh) return Response.json({ error: "Not signed in with GitHub" }, { status: 401 });

  let body: { token?: string; teamId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const token = (body.token ?? "").trim();
  const teamId = (body.teamId ?? "").trim() || undefined;
  if (!token) {
    return Response.json({ error: "A Vercel access token is required" }, { status: 400 });
  }

  const session = { token, teamId };
  try {
    const me = await validateVercel(session);
    await setVercelSession(session);
    return Response.json({ connected: true, username: me.username });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Vercel validation failed: ${message.slice(0, 200)}` },
      { status: 401 }
    );
  }
}

export async function DELETE() {
  await clearSession(["vercel"]);
  return Response.json({ ok: true });
}
