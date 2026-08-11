"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, RotateCcw, Download, ExternalLink, Workflow, Square } from "lucide-react";
import StageCard, { type StageState } from "@/components/StageCard";
import { STAGES, type StageId } from "@/lib/stages";

const SAMPLES = [
  "A habit-tracking app for remote teams where streaks unlock charity donations from the company",
  "An internal tool that lets support agents search past tickets semantically and draft replies",
  "A marketplace where local farms list surplus produce and restaurants bid on same-day pickup",
];

// How much of each prior stage's output is forwarded as context to the next stage.
const CONTEXT_PER_STAGE = 6_000;

function initialStages(): StageState[] {
  return STAGES.map((s) => ({
    id: s.id,
    title: s.title,
    role: s.role,
    description: s.description,
    status: "pending",
    output: "",
  }));
}

export default function Home() {
  const [requirement, setRequirement] = useState("");
  const [stages, setStages] = useState<StageState[]>(initialStages);
  const [running, setRunning] = useState(false);
  const [serverMode, setServerMode] = useState<"live" | "demo" | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setServerMode(d.mode))
      .catch(() => setServerMode(null));
  }, []);

  const patchStage = useCallback((id: StageId, patch: Partial<StageState>) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const runPipeline = useCallback(async () => {
    const req = requirement.trim();
    if (!req || running) return;
    cancelRef.current = false;
    setRunning(true);
    setStages(initialStages());

    const outputs: Partial<Record<StageId, string>> = {};

    for (const stage of STAGES) {
      if (cancelRef.current) {
        patchStage(stage.id, { status: "pending" });
        continue;
      }
      patchStage(stage.id, { status: "running" });
      const started = performance.now();
      try {
        // Each stage sees the tail of every previous stage's output.
        const context = STAGES.filter((s) => outputs[s.id])
          .map((s) => `### ${s.title}\n${outputs[s.id]!.slice(0, CONTEXT_PER_STAGE)}`)
          .join("\n\n");

        const res = await fetch("/api/pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stageId: stage.id, requirement: req, context }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `Stage failed with HTTP ${res.status}`);
        }
        const data = await res.json();
        outputs[stage.id] = data.output;
        patchStage(stage.id, {
          status: "done",
          output: data.output,
          mode: data.mode,
          model: data.model,
          note: data.note,
          durationMs: performance.now() - started,
        });
      } catch (err) {
        patchStage(stage.id, {
          status: "error",
          note: err instanceof Error ? err.message : "Stage failed",
          durationMs: performance.now() - started,
        });
        break;
      }
    }
    setRunning(false);
  }, [requirement, running, patchStage]);

  const stop = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const reset = useCallback(() => {
    cancelRef.current = true;
    setStages(initialStages());
    setRunning(false);
  }, []);

  const downloadArtifacts = useCallback(() => {
    const doneStages = stages.filter((s) => s.output);
    if (doneStages.length === 0) return;
    const md = [
      `# SDLC Pipeline Artifacts`,
      ``,
      `**Requirement:** ${requirement.trim()}`,
      ``,
      ...doneStages.flatMap((s) => [`---`, ``, `# ${s.title} (${s.role})`, ``, s.output, ``]),
    ].join("\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sdlc-pipeline-artifacts.md";
    a.click();
    URL.revokeObjectURL(url);
  }, [stages, requirement]);

  const anyOutput = stages.some((s) => s.output);
  const allDone = stages.every((s) => s.status === "done");

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
                Seven AI agents take one idea from requirements to release
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {serverMode && (
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                  serverMode === "live"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-amber-500/15 text-amber-400"
                }`}
                title={
                  serverMode === "live"
                    ? "Connected to the Gemini API"
                    : "No GEMINI_API_KEY configured — outputs are pre-scripted"
                }
              >
                {serverMode === "live" ? "AI: live" : "AI: demo mode"}
              </span>
            )}
            <a
              href="https://github.com/yashzord/sdlc-ai-pipeline"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
              title="View source on GitHub"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </header>

      {/* Input */}
      <section className="mb-8 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <label htmlFor="requirement" className="mb-2 block text-xs font-medium text-slate-400">
          Describe the product or feature you want built
        </label>
        <textarea
          id="requirement"
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
          disabled={running}
          rows={3}
          maxLength={2000}
          placeholder="e.g. A tool that turns meeting recordings into tracked action items with owners and due dates…"
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
              {sample.length > 60 ? sample.slice(0, 57) + "…" : sample}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          {!running ? (
            <button
              onClick={runPipeline}
              disabled={!requirement.trim()}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play className="h-4 w-4" />
              Run pipeline
            </button>
          ) : (
            <button
              onClick={stop}
              className="flex items-center gap-2 rounded-lg bg-rose-600/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-500"
            >
              <Square className="h-4 w-4" />
              Stop after current stage
            </button>
          )}
          <button
            onClick={reset}
            disabled={!anyOutput && !running}
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-40"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
          {anyOutput && (
            <button
              onClick={downloadArtifacts}
              className="ml-auto flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
            >
              <Download className="h-4 w-4" />
              Download artifacts
            </button>
          )}
        </div>
      </section>

      {/* Pipeline */}
      <section>
        {stages.map((stage, i) => (
          <StageCard key={stage.id} stage={stage} index={i} isLast={i === stages.length - 1} />
        ))}
      </section>

      {allDone && (
        <div className="mb-8 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center text-sm text-emerald-300">
          Pipeline complete — all seven stages delivered. Download the artifacts above to keep them.
        </div>
      )}

      <footer className="mt-4 border-t border-slate-800/60 pt-6 text-center text-xs text-slate-600">
        Built with Next.js · Gemini · GitHub Actions · Vercel —{" "}
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
