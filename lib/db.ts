// Supabase-backed persistence for pipeline runs. Accessed with the service
// role from server routes only (the app has its own GitHub-OAuth sessions);
// every query scopes by github_login. When the env vars are absent the app
// degrades gracefully to browser-only state.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Artifacts, ArtifactLink } from "./pipeline";
import type { StageId } from "./stages";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function dbEnabled(): boolean {
  return Boolean(url && serviceKey);
}

let cached: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!cached) {
    cached = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

export interface RunSummary {
  id: string;
  title: string | null;
  requirement: string;
  repo: string | null;
  status: string;
  created_at: string;
}

export interface StoredStage {
  stage_id: StageId;
  status: string;
  output: string | null;
  links: ArtifactLink[];
  model: string | null;
  note: string | null;
}

export async function createRun(login: string, requirement: string): Promise<string | null> {
  const { data, error } = await db()
    .from("sdlc_runs")
    .insert({ github_login: login, requirement })
    .select("id")
    .single();
  if (error) throw new Error(`DB createRun: ${error.message}`);
  return data?.id ?? null;
}

export async function saveStageResult(
  runId: string,
  login: string,
  stage: {
    stageId: StageId;
    status: string;
    output?: string;
    links?: ArtifactLink[];
    model?: string;
    note?: string;
  },
  artifacts: Artifacts,
  runStatus: string
): Promise<void> {
  // Ownership gate: only touch the run if it belongs to this login.
  const { data: run, error: runErr } = await db()
    .from("sdlc_runs")
    .update({
      artifacts,
      status: runStatus,
      title: artifacts.featureTitle ?? null,
      repo: artifacts.repo ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("github_login", login)
    .select("id")
    .maybeSingle();
  if (runErr) throw new Error(`DB saveStageResult(run): ${runErr.message}`);
  if (!run) return; // not this user's run — persist nothing

  const { error } = await db()
    .from("sdlc_stage_results")
    .upsert(
      {
        run_id: runId,
        stage_id: stage.stageId,
        status: stage.status,
        output: stage.output ?? null,
        links: stage.links ?? [],
        model: stage.model ?? null,
        note: stage.note ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "run_id,stage_id" }
    );
  if (error) throw new Error(`DB saveStageResult(stage): ${error.message}`);
}

export async function listRuns(login: string, limit = 15): Promise<RunSummary[]> {
  const { data, error } = await db()
    .from("sdlc_runs")
    .select("id,title,requirement,repo,status,created_at")
    .eq("github_login", login)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`DB listRuns: ${error.message}`);
  return (data ?? []) as RunSummary[];
}

export async function getRun(
  login: string,
  runId: string
): Promise<{ run: RunSummary & { artifacts: Artifacts }; stages: StoredStage[] } | null> {
  const { data: run, error } = await db()
    .from("sdlc_runs")
    .select("id,title,requirement,repo,status,created_at,artifacts")
    .eq("id", runId)
    .eq("github_login", login)
    .maybeSingle();
  if (error) throw new Error(`DB getRun: ${error.message}`);
  if (!run) return null;

  const { data: stages, error: stagesErr } = await db()
    .from("sdlc_stage_results")
    .select("stage_id,status,output,links,model,note")
    .eq("run_id", runId);
  if (stagesErr) throw new Error(`DB getRun(stages): ${stagesErr.message}`);

  return {
    run: run as RunSummary & { artifacts: Artifacts },
    stages: (stages ?? []) as StoredStage[],
  };
}
