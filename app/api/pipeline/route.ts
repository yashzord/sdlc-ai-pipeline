import { STAGES, type StageId } from "@/lib/stages";
import { hasLiveKey } from "@/lib/gemini";
import { getGithubSession, getJiraSession, getWorkspace } from "@/lib/session";
import { runStage, type Artifacts } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_REQUIREMENT_CHARS = 2_000;
const VALID_STAGES = new Set<StageId>(STAGES.map((s) => s.id));

interface PipelineRequest {
  stageId: StageId;
  requirement: string;
  artifacts?: Artifacts;
}

export async function POST(request: Request) {
  const gh = await getGithubSession();
  if (!gh) {
    return Response.json({ error: "Not signed in with GitHub" }, { status: 401 });
  }
  const workspace = await getWorkspace();
  if (!workspace) {
    return Response.json({ error: "No workspace repo configured" }, { status: 400 });
  }
  if (!hasLiveKey()) {
    return Response.json(
      { error: "GEMINI_API_KEY is not configured on the server — the pipeline cannot run" },
      { status: 503 }
    );
  }

  let body: PipelineRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const requirement = typeof body.requirement === "string" ? body.requirement.trim() : "";
  if (!body.stageId || !VALID_STAGES.has(body.stageId)) {
    return Response.json({ error: "Unknown stageId" }, { status: 400 });
  }
  if (!requirement || requirement.length > MAX_REQUIREMENT_CHARS) {
    return Response.json(
      { error: `requirement is required (max ${MAX_REQUIREMENT_CHARS} characters)` },
      { status: 400 }
    );
  }

  const jira = await getJiraSession();
  try {
    const result = await runStage(body.stageId, {
      gh,
      jira,
      workspace,
      requirement,
      artifacts: body.artifacts ?? {},
    });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message.slice(0, 500) }, { status: 502 });
  }
}
