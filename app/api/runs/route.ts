import { getGithubSession } from "@/lib/session";
import { createRun, dbEnabled, listRuns } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const gh = await getGithubSession();
  if (!gh) return Response.json({ error: "Not signed in with GitHub" }, { status: 401 });
  if (!dbEnabled()) return Response.json({ enabled: false, runs: [] });
  try {
    const runs = await listRuns(gh.login);
    return Response.json({ enabled: true, runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message.slice(0, 200) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const gh = await getGithubSession();
  if (!gh) return Response.json({ error: "Not signed in with GitHub" }, { status: 401 });
  if (!dbEnabled()) return Response.json({ runId: null });

  let body: { requirement?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const requirement = (body.requirement ?? "").trim();
  if (!requirement) return Response.json({ error: "requirement is required" }, { status: 400 });

  try {
    const runId = await createRun(gh.login, requirement);
    return Response.json({ runId });
  } catch (err) {
    // Persistence is best-effort — a DB hiccup must not block shipping.
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ runId: null, note: message.slice(0, 200) });
  }
}
