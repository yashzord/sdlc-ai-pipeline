"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LogOut, Play, RotateCcw, Workflow } from "lucide-react";
import StageCard, { type StageState } from "@/components/StageCard";
import SetupPanel, { type MeState } from "@/components/SetupPanel";
import { STAGES, type StageId } from "@/lib/stages";
import type { Artifacts } from "@/lib/pipeline";

const SAMPLES = [
  "A rate limiter library for API endpoints with sliding-window and burst support",
  "A markdown table-of-contents generator that handles nested headings and slug collisions",
  "A form validation engine with composable rules and helpful error messages",
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

  const patchStage = useCallback((id: StageId, patch: Partial<StageState>) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const executeStage = useCallback(
    async (stage: (typeof STAGES)[number], req: string): Promise<boolean> => {
      patchStage(stage.id, { status: "running", note: undefined });
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
              if (cancelRef.current) return false;
              await new Promise((r) => setTimeout(r, 30_000));
              continue;
            }
            throw new Error(msg);
          }

          artifactsRef.current = data.artifacts ?? artifactsRef.current;

          if (data.pending) {
            patchStage(stage.id, {
              status: "waiting",
              output: data.output,
              links: data.links ?? [],
            });
            if (cancelRef.current) return false;
            await new Promise((r) => setTimeout(r, CI_POLL_MS));
            continue;
          }

          patchStage(stage.id, {
            status: "done",
            output: data.output,
            links: data.links ?? [],
            model: data.model,
            note: undefined,
            durationMs: performance.now() - started,
          });
          return true;
        }
        throw new Error("Timed out waiting for CI to complete");
      } catch (err) {
        patchStage(stage.id, {
          status: "error",
          note: err instanceof Error ? err.message : "Stage failed",
          durationMs: performance.now() - started,
        });
        return false;
      }
    },
    [patchStage]
  );

  const runFrom = useCallback(
    async (fromIndex: number) => {
      const req = requirement.trim();
      if (!req || running) return;
      cancelRef.current = false;
      setRunning(true);
      if (fromIndex === 0) {
        artifactsRef.current = {};
        setStages(initialStages());
      } else {
        setStages((prev) =>
          prev.map((s, i) =>
            i >= fromIndex ? { ...s, status: "pending", output: "", links: [], note: undefined } : s
          )
        );
      }

      for (let i = fromIndex; i < STAGES.length; i++) {
        if (cancelRef.current) break;
        const ok = await executeStage(STAGES[i], req);
        if (!ok) break;
      }
      setRunning(false);
    },
    [requirement, running, executeStage]
  );

  const reset = useCallback(() => {
    cancelRef.current = true;
    artifactsRef.current = {};
    setStages(initialStages());
    setRunning(false);
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    reset();
    refreshMe();
  }, [refreshMe, reset]);

  const released = stages[stages.length - 1]?.status === "done";
  const readyToRun = Boolean(me?.github && me?.workspace && me?.ai);

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
                Seven AI agents ship a feature through real Jira, GitHub, and CI
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
            The pipeline creates real epics, stories, branches, pull requests, reviews, CI runs, and
            releases — in a workspace repo on your account. Sign in to let it work on your behalf.
          </p>
          <a
            href="/api/auth/login"
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
          >
            Sign in with GitHub
          </a>
          {!me.ai && (
            <p className="mt-4 text-xs text-rose-400">
              Note: GEMINI_API_KEY is missing on the server — runs will fail until the owner adds it.
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
              Describe the feature to ship (it will be implemented as a TypeScript module with
              tests, in your workspace repo)
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
              <button
                onClick={reset}
                disabled={running && false}
                className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-40"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
              {!me.workspace && (
                <span className="text-xs text-amber-400">Set up a workspace repo first ↑</span>
              )}
            </div>
          </section>

          {/* Pipeline */}
          <section>
            {stages.map((stage, i) => (
              <StageCard
                key={stage.id}
                stage={stage}
                index={i}
                isLast={i === stages.length - 1}
                onRetry={!running ? () => runFrom(i) : undefined}
              />
            ))}
          </section>

          {released && (
            <div className="mb-8 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center text-sm text-emerald-300">
              Feature shipped — PR merged, release published, tickets closed. That's the whole
              lifecycle.
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
