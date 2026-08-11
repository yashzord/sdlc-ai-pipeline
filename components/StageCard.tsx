"use client";

import { useState } from "react";
import {
  Target,
  ClipboardList,
  MessageCircleQuestion,
  ListChecks,
  Network,
  Stamp,
  Code2,
  SearchCheck,
  Wrench,
  FlaskConical,
  HeartPulse,
  UserCheck,
  ShieldCheck,
  Rocket,
  Check,
  Copy,
  ChevronDown,
  Loader2,
  RotateCcw,
  CircleDashed,
  AlertTriangle,
  ExternalLink,
  SkipForward,
  UserRound,
} from "lucide-react";
import Markdown from "./Markdown";
import type { StageId } from "@/lib/stages";
import type { ArtifactLink, GateInput, GateSpec } from "@/lib/pipeline";

const STAGE_ICONS: Record<StageId, React.ComponentType<{ className?: string }>> = {
  plan: Target,
  requirements: ClipboardList,
  clarify: MessageCircleQuestion,
  stories: ListChecks,
  architecture: Network,
  design_approval: Stamp,
  code: Code2,
  review: SearchCheck,
  rework: Wrench,
  tests: FlaskConical,
  ci_verify: HeartPulse,
  uat: UserCheck,
  release_approval: ShieldCheck,
  release: Rocket,
};

export type StageStatus = "pending" | "running" | "waiting" | "done" | "skipped" | "error";

export interface StageState {
  id: StageId;
  title: string;
  role: string;
  description: string;
  status: StageStatus;
  output: string;
  links: ArtifactLink[];
  model?: string;
  note?: string;
  durationMs?: number;
  gate?: GateSpec;
}

// Rendered when the pipeline pauses on a human gate — questions to answer or
// an approval decision. Submitting resumes the run with the input attached.
function GatePanel({
  gate,
  onSubmit,
  disabled,
}: {
  gate: GateSpec;
  onSubmit: (input: GateInput) => void;
  disabled: boolean;
}) {
  const [answers, setAnswers] = useState<string[]>(() =>
    gate.type === "questions" ? gate.questions.map(() => "") : []
  );
  const [comment, setComment] = useState("");
  const [requestingChanges, setRequestingChanges] = useState(false);

  if (gate.type === "questions") {
    return (
      <div className="border-t border-indigo-500/30 bg-indigo-500/5 p-4">
        <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-300">
          <UserRound className="h-3.5 w-3.5" />
          Your input is needed
        </p>
        <div className="space-y-3">
          {gate.questions.map((q, i) => (
            <div key={i}>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                {i + 1}. {q}
              </label>
              <textarea
                value={answers[i]}
                onChange={(e) =>
                  setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))
                }
                disabled={disabled}
                rows={2}
                maxLength={500}
                placeholder="Your decision (leave blank to let the team use its judgment)"
                className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-indigo-500 disabled:opacity-60"
              />
            </div>
          ))}
        </div>
        <button
          onClick={() => onSubmit({ answers })}
          disabled={disabled}
          className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Submit answers
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-indigo-500/30 bg-indigo-500/5 p-4">
      <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-300">
        <UserRound className="h-3.5 w-3.5" />
        {gate.title}
      </p>
      <p className="mb-3 text-xs text-slate-400">{gate.description}</p>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        disabled={disabled}
        rows={2}
        maxLength={500}
        placeholder={
          requestingChanges
            ? "Describe the changes you want (required)"
            : "Optional comment for the record"
        }
        className={`w-full resize-none rounded-lg border bg-slate-950 p-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-indigo-500 disabled:opacity-60 ${
          requestingChanges ? "border-amber-500/60" : "border-slate-700"
        }`}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!requestingChanges ? (
          <>
            <button
              onClick={() => onSubmit({ approved: true, comment: comment.trim() || undefined })}
              disabled={disabled}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Approve
            </button>
            {gate.allowChanges && (
              <button
                onClick={() => setRequestingChanges(true)}
                disabled={disabled}
                className="rounded-lg border border-amber-500/50 px-4 py-2 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/10 disabled:opacity-40"
              >
                Request changes
              </button>
            )}
          </>
        ) : (
          <>
            <button
              onClick={() => onSubmit({ approved: false, comment: comment.trim() })}
              disabled={disabled || !comment.trim()}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send change request
            </button>
            <button
              onClick={() => setRequestingChanges(false)}
              disabled={disabled}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 transition-colors hover:bg-slate-800 disabled:opacity-40"
            >
              Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function StageCard({
  stage,
  index,
  isLast,
  onRetry,
  onGateSubmit,
  gateDisabled = false,
}: {
  stage: StageState;
  index: number;
  isLast: boolean;
  onRetry?: () => void;
  onGateSubmit?: (input: GateInput) => void;
  gateDisabled?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const Icon = STAGE_ICONS[stage.id];
  const atGate = stage.status === "waiting" && Boolean(stage.gate);
  const active = stage.status === "running" || (stage.status === "waiting" && !atGate);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(stage.output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — ignore
    }
  };

  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${
            stage.status === "done"
              ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
              : active || atGate
                ? "stage-running border-indigo-500 bg-indigo-500/15 text-indigo-300"
                : stage.status === "error"
                  ? "border-rose-500/60 bg-rose-500/10 text-rose-400"
                  : "border-slate-700 bg-slate-900 text-slate-500"
          }`}
        >
          {active ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : atGate ? (
            <UserRound className="h-5 w-5" />
          ) : stage.status === "done" ? (
            <Check className="h-5 w-5" />
          ) : stage.status === "skipped" ? (
            <SkipForward className="h-5 w-5" />
          ) : stage.status === "error" ? (
            <AlertTriangle className="h-5 w-5" />
          ) : (
            <Icon className="h-5 w-5" />
          )}
        </div>
        {!isLast && (
          <div
            className={`w-px flex-1 ${
              stage.status === "done" || stage.status === "skipped"
                ? "bg-emerald-500/40"
                : "bg-slate-800"
            }`}
          />
        )}
      </div>

      <div className="mb-6 min-w-0 flex-1">
        <div
          className={`rounded-xl border transition-colors ${
            active || atGate
              ? "border-indigo-500/50 bg-slate-900/80"
              : stage.status === "done"
                ? "border-slate-700 bg-slate-900/60"
                : stage.status === "error"
                  ? "border-rose-500/40 bg-slate-900/60"
                  : "border-slate-800 bg-slate-900/40"
          }`}
        >
          <div className="flex items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-500">Stage {index + 1}</span>
                <h3 className="text-sm font-semibold text-slate-100">{stage.title}</h3>
                <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                  {stage.role}
                </span>
                {stage.status === "waiting" && (
                  <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-300">
                    {atGate ? "needs your decision" : "waiting on CI"}
                  </span>
                )}
                {stage.model && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-400">
                    {stage.model}
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
                {onRetry && (stage.status === "done" || stage.status === "skipped") && (
                  <button
                    onClick={onRetry}
                    className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
                    title="Re-run the pipeline from this stage"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
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

          {stage.links.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-3">
              {stage.links.map((link) =>
                link.url ? (
                  <a
                    key={`${link.label}-${link.url}`}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-300 transition-colors hover:bg-indigo-500/25"
                  >
                    {link.label}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null
              )}
            </div>
          )}

          {stage.note && (
            <div
              className={`mx-4 mb-3 rounded-md px-3 py-2 text-xs ${
                stage.status === "error"
                  ? "bg-rose-500/10 text-rose-300"
                  : "bg-slate-800/60 text-slate-400"
              }`}
            >
              {stage.note}
              {onRetry && stage.status === "error" && (
                <button
                  onClick={onRetry}
                  className="mt-2 block rounded-md border border-rose-400/40 px-2.5 py-1 font-medium text-rose-200 transition-colors hover:bg-rose-500/20"
                >
                  Retry from this stage
                </button>
              )}
            </div>
          )}

          {stage.output && !collapsed && (
            <div className="border-t border-slate-800 p-4">
              <Markdown text={stage.output} />
            </div>
          )}

          {atGate && stage.gate && onGateSubmit && (
            <GatePanel gate={stage.gate} onSubmit={onGateSubmit} disabled={gateDisabled} />
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
