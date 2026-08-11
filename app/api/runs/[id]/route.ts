import { getGithubSession } from "@/lib/session";
import { dbEnabled, getRun } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gh = await getGithubSession();
  if (!gh) return Response.json({ error: "Not signed in with GitHub" }, { status: 401 });
  if (!dbEnabled()) return Response.json({ error: "Persistence is not enabled" }, { status: 404 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return Response.json({ error: "Invalid run id" }, { status: 400 });
  }

  try {
    const result = await getRun(gh.login, id);
    if (!result) return Response.json({ error: "Run not found" }, { status: 404 });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message.slice(0, 200) }, { status: 502 });
  }
}
