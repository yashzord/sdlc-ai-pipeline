"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { History, LogOut, Play, RotateCcw, StepForward, Workflow } from "lucide-react";
import StageCard, { type StageState } from "@/components/StageCard";
import SetupPanel, { type MeState } from "@/components/SetupPanel";
import MaintenancePanel from "@/components/MaintenancePanel";
import { PHASES, STAGES, type StageId } from "@/lib/stages";
import type { Artifacts, GateInput } from "@/lib/pipeline";

const SAMPLES = [
  "A pomodoro timer with task tracking and daily focus stats",
  "An expense splitter for roommates that settles who owes whom",
  "A flashcard study app with spaced repetition and progress tracking",
];

const CI_POLL_MS = 15_000;
const CI_MAX_POLLS = 24;

// Mobile browsers drop in-flight requests when backgrounded ("Load failed") —
// retry transient network errors before declaring the stage dead.
async function fetchWithRetry(input: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2_000 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Network request failed");
}

interface RunSummary {
  id: string;
  title: string | null;
  requirement: string;
  repo: string | null;
  status: string;
  created_at: string;
}

function initialStages(): StageState[] {
  return STAGES.map((s) => ({
    id: s.id,
    title: s.title,
    role: s.role,
    description: s.description,
    status: "pending",
    output: "",
    links: [],
  }));
}

export default function Home() {
  const [me, setMe] = useState<MeState | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [requirement, setRequirement] = useState("");
  const [stages, setStages] = useState<StageState[]>(initialStages);
  const [running, setRunning] = useState(false);
  const artifactsRef = useRef<Artifacts>({});
  const cancelRef = useRef(false);
  const runIdRef = useRef<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [noGo, setNoGo] = useState(false);

  const loadRuns = useCallback(() => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then((d) => setRuns(d.enabled ? d.runs : null))
      .catch(() => setRuns(null));
  }, []);

  const refreshMe = useCallback(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setMe(d))
      .catch(() => setMe(null))
      .finally(() => setMeLoaded(true));
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    if (me?.github) loadRuns();
  }, [me?.github, loadRuns]);

  const patchStage = useCallback((id: StageId, patch: Partial<StageState>) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const executeStage = useCallback(
    async (
      stage: (typeof STAGES)[number],
      req: string,
      gateInput?: GateInput
    ): Promise<"done" | "gate" | "stop"> => {
      patchStage(stage.id, { status: "running", note: undefined, gate: undefined });
      const started = performance.now();
      try {
        for (let attempt = 0; attempt <= CI_MAX_POLLS; attempt++) {
          const res = await fetchWithRetry("/api/pipeline", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stageId: stage.id,
              requirement: req,
              artifacts: artifactsRef.current,
              runId: runIdRef.current ?? undefined,
              input: gateInput,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            const msg = data.error ?? `Stage failed with HTTP ${res.status}`;
            // Free-tier AI quotas are per-minute — wait out rate limits
            // instead of failing the run.
            if (/429|quota|rate limit/i.test(msg) && attempt < CI_MAX_POLLS) {
              patchStage(stage.id, {
                status: "waiting",
                note: "AI rate limit hit — waiting 30s and retrying automatically…",
              });
              if (cancelRef.current) return "stop";
              await new Promise((r) => setTimeout(r, 30_000));
              continue;
            }
            throw new Error(msg);
          }

          artifactsRef.current = data.artifacts ?? artifactsRef.current;

          // Human gate: the pipeline pauses here until the stakeholder responds.
          if (data.gate) {
            patchStage(stage.id, {
              status: "waiting",
              output: data.output,
              links: data.links ?? [],
              gate: data.gate,
            });
            return "gate";
          }

          if (data.pending) {
            patchStage(stage.id, {
              status: "waiting",
              output: data.output,
              links: data.links ?? [],
            });
            if (cancelRef.current) return "stop";
            await new Promise((r) => setTimeout(r, CI_POLL_MS));
            continue;
          }

          patchStage(stage.id, {
            status: "done",
            output: data.output,
            links: data.links ?? [],
            model: data.model,
            note: undefined,
            gate: undefined,
            durationMs: performance.now() - started,
          });
          return "done";
        }
        throw new Error("Timed out waiting for CI to complete");
      } catch (err) {
        patchStage(stage.id, {
          status: "error",
          note: err instanceof Error ? err.message : "Stage failed",
          durationMs: performance.now() - started,
        });
        return "stop";
      }
    },
    [patchStage]
  );

  const runFrom = useCallback(
    async (fromIndex: number, gateInput?: GateInput) => {
      const req = requirement.trim();
      if (!req || running) return;
      cancelRef.current = false;
      setRunning(true);
      setNoGo(false);
      if (fromIndex === 0) {
        artifactsRef.current = {};
        setStages(initialStages());
        runIdRef.current = null;
        try {
          const res = await fetch("/api/runs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requirement: req }),
          });
          const data = await res.json().catch(() => ({}));
          runIdRef.current = data.runId ?? null;
        } catch {
          // Persistence is best-effort — run without it.
        }
      } else {
        setStages((prev) =>
          prev.map((s, i) =>
            i >= fromIndex
              ? { ...s, status: "pending", output: "", links: [], note: undefined, gate: undefined }
              : s
          )
        );
      }

      for (let i = fromIndex; i < STAGES.length; i++) {
        if (cancelRef.current) break;
        // The rework stage is a conditional step: it only runs when the
        // review demanded changes.
        if (
          STAGES[i].id === "rework" &&
          artifactsRef.current.reviewVerdict !== "REQUEST CHANGES"
        ) {
          patchStage("rework", {
            status: "skipped",
            note: `Skipped — review verdict was ${artifactsRef.current.reviewVerdict ?? "APPROVE"}, no rework required.`,
          });
          continue;
        }
        // The gate input belongs only to the stage that asked for it.
        const result = await executeStage(STAGES[i], req, i === fromIndex ? gateInput : undefined);
        if (result !== "done") break;
        // A NO-GO verdict from planning ends the run — a real SDLC stops
        // before building something infeasible.
        if (STAGES[i].id === "plan" && artifactsRef.current.planVerdict === "NO-GO") {
          setNoGo(true);
          break;
        }
      }
      setRunning(false);
      loadRuns();
    },
    [requirement, running, executeStage, loadRuns, patchStage]
  );

  const submitGate = useCallback(
    (index: number, input: GateInput) => {
      void runFrom(index, input);
    },
    [runFrom]
  );

  const resumeRun = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/runs/${id}`);
      if (!res.ok) return;
      const { run, stages: stored } = await res.json();
      cancelRef.current = true;
      runIdRef.current = run.id;
      artifactsRef.current = run.artifacts ?? {};
      setNoGo(run.status === "rejected");
      setRequirement(run.requirement);
      setStages(
        STAGES.map((meta) => {
          const s = (stored as Array<{ stage_id: string; status: string; output: string | null; links: unknown; model: string | null; note: string | null }>).find(
            (x) => x.stage_id === meta.id
          );
          return {
            id: meta.id,
            title: meta.title,
            role: meta.role,
            description: meta.description,
            status: s
              ? s.status === "done"
                ? ("done" as const)
                : s.status === "error"
                  ? ("error" as const)
                  : ("pending" as const)
              : ("pending" as const),
            output: s?.output ?? "",
            links: (s?.links as StageState["links"]) ?? [],
            model: s?.model ?? undefined,
            note: s?.note ?? undefined,
          };
        })
      );
      setHistoryOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      // ignore — history stays as-is
    }
  }, []);

  const reset = useCallback(() => {
    cancelRef.current = true;
    artifactsRef.current = {};
    runIdRef.current = null;
    setStages(initialStages());
    setRunning(false);
    setNoGo(false);
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    reset();
    refreshMe();
  }, [refreshMe, reset]);

  const released = stages[stages.length - 1]?.status === "done";
  const readyToRun = Boolean(me?.github && (me?.serverAi || me?.byokAi));
  const firstIncomplete = stages.findIndex(
    (s) => s.status !== "done" && s.status !== "skipped"
  );
  const canContinue = !running && firstIncomplete > 0 && requirement.trim().length > 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400">
              <Workflow className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-100">SDLC AI Pipeline</h1>
              <p className="text-xs text-slate-500">
                Type an idea — AI agents run all 7 SDLC phases and ship it live, with you at every
                decision gate
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {me?.github && (
              <>
                <img
                  src={me.github.avatarUrl}
                  alt={me.github.login}
                  className="h-7 w-7 rounded-full border border-slate-700"
                />
                <span className="hidden text-xs text-slate-400 sm:inline">{me.github.login}</span>
                <button
                  onClick={signOut}
                  className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {!meLoaded ? (
        <p className="text-center text-sm text-slate-500">Loading…</p>
      ) : !me?.oauthConfigured ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-center text-sm text-amber-300">
          The app owner hasn't finished server setup: GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET /
          SESSION_SECRET env vars are missing on the deployment.
        </div>
      ) : !me.github ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-10 text-center">
          <h2 className="mb-2 text-base font-semibold text-slate-100">
            Connect GitHub to start shipping
          </h2>
          <p className="mx-auto mb-6 max-w-md text-sm text-slate-400">
            Describe an idea and the pipeline ships it for real: its own repo on your account,
            tickets, a reviewed pull request, tests in CI — and a live app link on GitHub Pages
            when it releases.
          </p>
          <a
            href="/api/auth/login"
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
          >
            Sign in with GitHub
          </a>
          {!me.serverAi && (
            <p className="mt-4 text-xs text-amber-400">
              No built-in AI is configured on this deployment — after signing in you can connect
              your own AI key (Gemini, Claude, Groq, or OpenRouter).
            </p>
          )}
        </div>
      ) : (
        <>
          <SetupPanel me={me} onChanged={refreshMe} disabled={running} />

          {/* Input */}
          <section className="mb-8 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <label
              htmlFor="requirement"
              className="mb-2 block text-xs font-medium text-slate-400"
            >
              Describe the app to ship — it gets its own repo, a reviewed PR, tests in CI, and a
              live link when it releases
            </label>
            <textarea
              id="requirement"
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              disabled={running}
              rows={3}
              maxLength={2000}
              placeholder="e.g. A retry helper with exponential backoff, jitter, and an abort signal…"
              className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-indigo-500 disabled:opacity-60"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SAMPLES.map((sample) => (
                <button
                  key={sample}
                  onClick={() => setRequirement(sample)}
                  disabled={running}
                  className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 transition-colors hover:border-indigo-500/60 hover:text-slate-200 disabled:opacity-50"
                >
                  {sample.length > 64 ? sample.slice(0, 61) + "…" : sample}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => runFrom(0)}
                disabled={running || !requirement.trim() || !readyToRun}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play className="h-4 w-4" />
                {running ? "Shipping…" : "Ship this feature"}
              </button>
              {canContinue && (
                <button
                  onClick={() => runFrom(firstIncomplete)}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                >
                  <StepForward className="h-4 w-4" />
                  Continue: {STAGES[firstIncomplete].title}
                </button>
              )}
              <button
                onClick={reset}
                disabled={running && false}
                className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-40"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
            </div>
          </section>

          {/* Run history */}
          {runs !== null && runs.length > 0 && (
            <section className="mb-8 rounded-xl border border-slate-800 bg-slate-900/50">
              <button
                onClick={() => setHistoryOpen((o) => !o)}
                className="flex w-full items-center justify-between p-4 text-sm font-semibold text-slate-200"
              >
                <span className="flex items-center gap-2">
                  <History className="h-4 w-4 text-indigo-400" />
                  Run history
                  <span className="text-xs font-normal text-slate-500">({runs.length})</span>
                </span>
                <span className="text-xs font-normal text-slate-500">
                  {historyOpen ? "Hide" : "Show"}
                </span>
              </button>
              {historyOpen && (
                <ul className="border-t border-slate-800">
                  {runs.map((run) => (
                    <li
                      key={run.id}
                      className="flex items-center justify-between gap-3 border-b border-slate-800/60 px-4 py-3 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-200">
                          {run.title ?? run.requirement.slice(0, 60)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {new Date(run.created_at).toLocaleString()}
                          {run.repo ? ` · ${run.repo}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                            run.status === "released"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : run.status === "blocked"
                                ? "bg-rose-500/15 text-rose-400"
                                : "bg-amber-500/15 text-amber-400"
                          }`}
                        >
                          {run.status}
                        </span>
                        <button
                          onClick={() => resumeRun(run.id)}
                          disabled={running}
                          className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-40"
                        >
                          Open
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Pipeline — stages grouped under the 7 canonical SDLC phases */}
          <section>
            {stages.map((stage, i) => {
              const phase = STAGES[i].phase;
              const isPhaseStart = i === 0 || STAGES[i - 1].phase !== phase;
              return (
                <div key={stage.id}>
                  {isPhaseStart && (
                    <div className="mb-3 flex items-center gap-2 pl-14">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                        Phase {PHASES.indexOf(phase) + 1}
                      </span>
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {phase}
                      </span>
                      <span className="h-px flex-1 bg-slate-800" />
                    </div>
                  )}
                  <StageCard
                    stage={stage}
                    index={i}
                    isLast={i === stages.length - 1}
                    onRetry={!running ? () => runFrom(i) : undefined}
                    onGateSubmit={(input) => submitGate(i, input)}
                    gateDisabled={running}
                  />
                </div>
              );
            })}

            {/* Phase 7 — Maintenance: an ongoing cycle, not a stage that "completes" */}
            <div className="mb-3 flex items-center gap-2 pl-14">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                Phase 7
              </span>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Maintenance
              </span>
              <span className="h-px flex-1 bg-slate-800" />
            </div>
            <div className="pl-14">
              <MaintenancePanel repo={artifactsRef.current.repo} released={released} />
            </div>
          </section>

          {noGo && (
            <div className="mt-8 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-center text-sm text-rose-300">
              Planning returned a NO-GO — the feasibility study rejected this idea, so the
              lifecycle stops before anything is built. Refine the idea and run again.
            </div>
          )}

          {released && (
            <div className="mt-8 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center text-sm text-emerald-300">
              Product shipped — planned, specified, designed, built, reviewed, tested, approved,
              and deployed. Maintenance is now open above; that's the whole lifecycle.
            </div>
          )}
        </>
      )}

      <footer className="mt-4 border-t border-slate-800/60 pt-6 text-center text-xs text-slate-600">
        Next.js · Gemini · GitHub · Jira · Vercel —{" "}
        <a
          href="https://github.com/yashzord/sdlc-ai-pipeline"
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
        >
          source
        </a>
      </footer>
    </main>
  );
}
