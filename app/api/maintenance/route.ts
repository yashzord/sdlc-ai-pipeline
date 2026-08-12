import { getGithubSession } from "@/lib/session";
import { createIssue, parseRepo } from "@/lib/github";

export const dynamic = "force-dynamic";

// Maintenance phase intake covering all four canonical maintenance types.
// Each request becomes a real, labeled GitHub issue on the shipped repo.
const MAINTENANCE_TYPES = {
  bug: { labels: ["bug", "maintenance"], kind: "Corrective maintenance" },
  adaptive: { labels: ["adaptive", "maintenance"], kind: "Adaptive maintenance" },
  enhancement: { labels: ["enhancement", "maintenance"], kind: "Perfective maintenance" },
  preventive: { labels: ["preventive", "maintenance"], kind: "Preventive maintenance" },
} as const;

interface MaintenanceRequest {
  repo: string;
  type: keyof typeof MAINTENANCE_TYPES;
  title: string;
  description: string;
}

export async function POST(request: Request) {
  const gh = await getGithubSession();
  if (!gh) {
    return Response.json({ error: "Not signed in with GitHub" }, { status: 401 });
  }

  let body: MaintenanceRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const meta = MAINTENANCE_TYPES[body.type];
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!meta || !title || title.length > 120 || description.length > 2_000) {
    return Response.json(
      {
        error: "type must be bug|adaptive|enhancement|preventive, title 1-120 chars, description up to 2000",
      },
      { status: 400 }
    );
  }

  let ref;
  try {
    ref = parseRepo(typeof body.repo === "string" ? body.repo : "");
  } catch {
    return Response.json({ error: "Invalid repo" }, { status: 400 });
  }
  // Issues are only filed on the signed-in user's own shipped repos.
  if (ref.owner.toLowerCase() !== gh.login.toLowerCase()) {
    return Response.json({ error: "Repo does not belong to your account" }, { status: 403 });
  }

  try {
    const issue = await createIssue(
      gh.token,
      ref,
      title,
      `**${meta.kind}** — filed from the Maintenance phase of the SDLC AI Pipeline.\n\n${description || "_No further details provided._"}`,
      [...meta.labels]
    );
    return Response.json({ number: issue.number, url: issue.html_url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message.slice(0, 500) }, { status: 502 });
  }
}
