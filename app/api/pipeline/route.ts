import { STAGE_MAP, type StageId } from "@/lib/stages";
import { generateWithGemini, hasLiveKey } from "@/lib/gemini";
import { demoOutput } from "@/lib/demo";

export const maxDuration = 60;

const MAX_REQUIREMENT_CHARS = 2_000;
const MAX_CONTEXT_CHARS = 24_000;

interface PipelineRequest {
  stageId: StageId;
  requirement: string;
  context?: string;
}

export async function POST(request: Request) {
  let body: PipelineRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const stage = body.stageId ? STAGE_MAP[body.stageId] : undefined;
  const requirement = typeof body.requirement === "string" ? body.requirement.trim() : "";
  if (!stage) {
    return Response.json({ error: "Unknown stageId" }, { status: 400 });
  }
  if (!requirement) {
    return Response.json({ error: "requirement is required" }, { status: 400 });
  }
  if (requirement.length > MAX_REQUIREMENT_CHARS) {
    return Response.json(
      { error: `requirement must be under ${MAX_REQUIREMENT_CHARS} characters` },
      { status: 400 }
    );
  }

  const context = (typeof body.context === "string" ? body.context : "").slice(
    -MAX_CONTEXT_CHARS
  );

  if (hasLiveKey()) {
    try {
      const { text, model } = await generateWithGemini(
        stage.system,
        stage.buildPrompt(requirement, context)
      );
      return Response.json({ output: text, mode: "live", model });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({
        output: demoOutput(stage.id, requirement),
        mode: "demo",
        note: `Live call failed, served demo output instead: ${message.slice(0, 200)}`,
      });
    }
  }

  return Response.json({
    output: demoOutput(stage.id, requirement),
    mode: "demo",
  });
}
