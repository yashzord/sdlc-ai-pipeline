import { getGithubSession } from "@/lib/session";
import { archiveRepo, parseRepo } from "@/lib/github";

export const dynamic = "force-dynamic";

// End-of-life: the final maintenance activity. Archiving freezes the
// repository read-only — the product's history, releases, and live Pages
// deployment remain, but no further changes land.
export async function POST(request: Request) {
  const gh = await getGithubSession();
  if (!gh) {
    return Response.json({ error: "Not signed in with GitHub" }, { status: 401 });
  }

  let body: { repo?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let ref;
  try {
    ref = parseRepo(typeof body.repo === "string" ? body.repo : "");
  } catch {
    return Response.json({ error: "Invalid repo" }, { status: 400 });
  }
  if (ref.owner.toLowerCase() !== gh.login.toLowerCase()) {
    return Response.json({ error: "Repo does not belong to your account" }, { status: 403 });
  }

  try {
    const result = await archiveRepo(gh.token, ref);
    return Response.json({
      archived: result.archived,
      output: `Product retired — the repository is archived (read-only). Its releases and live deployment remain available as the historical record.`,
      links: [{ label: "Archived repo", url: result.html_url }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message.slice(0, 500) }, { status: 502 });
  }
}
