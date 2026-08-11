"use client";

import { useState } from "react";
import {
  ClipboardList,
  ListChecks,
  Network,
  Code2,
  SearchCheck,
  FlaskConical,
  Rocket,
  Check,
  Copy,
  ChevronDown,
  Loader2,
  CircleDashed,
  AlertTriangle,
} from "lucide-react";
import Markdown from "./Markdown";
import type { StageId } from "@/lib/stages";

const STAGE_ICONS: Record<StageId, React.ComponentType<{ className?: string }>> = {
  requirements: ClipboardList,
  stories: ListChecks,
  architecture: Network,
  code: Code2,
  review: SearchCheck,
  tests: FlaskConical,
  release: Rocket,
};

export type StageStatus = "pending" | "running" | "done" | "error";

export interface StageState {
  id: StageId;
  title: string;
  role: string;
  description: string;
  status: StageStatus;
  output: string;
  model?: string;
  note?: string;
  durationMs?: number;
}

export default function StageCard({
  stage,
  index,
  isLast,
}: {
  stage: StageState;
  index: number;
  isLast: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const Icon = STAGE_ICONS[stage.id];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(stage.output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (permissions/insecure context) — ignore
    }
  };

  return (
    <div className="relative flex gap-4">
      {/* Timeline rail */}
      <div className="flex flex-col items-center">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${
            stage.status === "done"
              ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
              : stage.status === "running"
                ? "stage-running border-indigo-500 bg-indigo-500/15 text-indigo-300"
                : stage.status === "error"
                  ? "border-rose-500/60 bg-rose-500/10 text-rose-400"
                  : "border-slate-700 bg-slate-900 text-slate-500"
          }`}
        >
          {stage.status === "running" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : stage.status === "done" ? (
            <Check className="h-5 w-5" />
          ) : stage.status === "error" ? (
            <AlertTriangle className="h-5 w-5" />
          ) : (
            <Icon className="h-5 w-5" />
          )}
        </div>
        {!isLast && (
          <div
            className={`w-px flex-1 ${
              stage.status === "done" ? "bg-emerald-500/40" : "bg-slate-800"
            }`}
          />
        )}
      </div>

      {/* Card */}
      <div className="mb-6 min-w-0 flex-1">
        <div
          className={`rounded-xl border transition-colors ${
            stage.status === "running"
              ? "border-indigo-500/50 bg-slate-900/80"
              : stage.status === "done"
                ? "border-slate-700 bg-slate-900/60"
                : "border-slate-800 bg-slate-900/40"
          }`}
        >
          <div className="flex items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-500">
                  Stage {index + 1}
                </span>
                <h3 className="text-sm font-semibold text-slate-100">{stage.title}</h3>
                <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                  {stage.role}
                </span>
                {stage.model && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-400">
                    live · {stage.model}
                  </span>
                )}
                {stage.durationMs !== undefined && (
                  <span className="text-[10px] text-slate-500">
                    {(stage.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{stage.description}</p>
            </div>
            {stage.output && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={copy}
                  className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
                  title="Copy output"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
                <button
                  onClick={() => setCollapsed((c) => !c)}
                  className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
                  title={collapsed ? "Expand" : "Collapse"}
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${collapsed ? "-rotate-90" : ""}`}
                  />
                </button>
              </div>
            )}
          </div>

          {stage.note && (
            <p className="mx-4 mb-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              {stage.note}
            </p>
          )}

          {stage.output && !collapsed && (
            <div className="border-t border-slate-800 p-4">
              <Markdown text={stage.output} />
            </div>
          )}

          {stage.status === "pending" && !stage.output && (
            <div className="flex items-center gap-2 border-t border-slate-800/60 px-4 py-3 text-xs text-slate-600">
              <CircleDashed className="h-3.5 w-3.5" />
              Waiting for previous stage…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
