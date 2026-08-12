"use client";

import { useRef, useState } from "react";
import {
  Archive,
  Bug,
  ExternalLink,
  Loader2,
  MonitorCog,
  Rocket,
  ShieldPlus,
  Sparkles,
  Undo2,
  Wrench,
} from "lucide-react";

type MaintenanceType = "bug" | "adaptive" | "enhancement" | "preventive";

// The four canonical maintenance types, each becoming a labeled issue and an
// optional full fix cycle (branch → PR → CI → merge → patch release).
const TYPES: Array<{
  id: MaintenanceType;
  label: string;
  kind: string;
  icon: React.ComponentType<{ className?: string }>;
  active: string;
  titlePlaceholder: string;
  descPlaceholder: string;
}> = [
  {
    id: "bug",
    label: "Bug",
    kind: "corrective",
    icon: Bug,
    active: "border-rose-500/60 bg-rose-500/10 text-rose-300",
    titlePlaceholder: "What's broken? (one line)",
    descPlaceholder: "Steps to reproduce, expected vs actual behavior…",
  },
  {
    id: "adaptive",
    label: "Adaptive",
    kind: "adaptive",
    icon: MonitorCog,
    active: "border-amber-500/60 bg-amber-500/10 text-amber-300",
    titlePlaceholder: "What changed in the environment?",
    descPlaceholder: "New browser behavior, platform change, or compatibility need to adapt to…",
  },
  {
    id: "enhancement",
    label: "Enhancement",
    kind: "perfective",
    icon: Sparkles,
    active: "border-indigo-500/60 bg-indigo-500/10 text-indigo-300",
    titlePlaceholder: "What should be improved?",
    descPlaceholder: "Describe the improvement and why it matters…",
  },
  {
    id: "preventive",
    label: "Preventive",
    kind: "preventive",
    icon: ShieldPlus,
    active: "border-emerald-500/60 bg-emerald-500/10 text-emerald-300",
    titlePlaceholder: "What should be hardened or cleaned up?",
    descPlaceholder: "Refactoring, robustness, or technical-debt work — no behavior change…",
  },
];

const TYPE_BADGE: Record<MaintenanceType, string> = {
  bug: "bg-rose-500/15 text-rose-300",
  adaptive: "bg-amber-500/15 text-amber-300",
  enhancement: "bg-indigo-500/15 text-indigo-300",
  preventive: "bg-emerald-500/15 text-emerald-300",
};

interface FiledIssue {
  number: number;
  url: string;
  title: string;
  type: MaintenanceType;
}

interface CycleLink {
  label: string;
  url: string;
}

interface CycleStatus {
  phase: "running" | "shipped" | "error";
  note: string;
  links: CycleLink[];
}

const CYCLE_POLL_MS = 15_000;
const CYCLE_MAX_POLLS = 24;

// The Maintenance phase never "completes" — after release, the product enters
// an ongoing cycle of corrective, adaptive, perfective, and preventive work,
// with rollback and end-of-life retirement closing the lifecycle.
export default function MaintenancePanel({
  repo,
  released,
}: {
  repo?: string;
  released: boolean;
}) {
  const [type, setType] = useState<MaintenanceType>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<FiledIssue[]>([]);
  const [cycles, setCycles] = useState<Record<number, CycleStatus>>({});
  const [lifecycle, setLifecycle] = useState<{
    action: "rollback" | "retire";
    phase: "running" | "done" | "error";
    note: string;
    links: CycleLink[];
  } | null>(null);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [retired, setRetired] = useState(false);
  const cancelRef = useRef(false);

  if (!released || !repo) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500">
        <span className="flex items-center gap-2">
          <Wrench className="h-3.5 w-3.5" />
          Maintenance begins once the product ships — corrective, adaptive, perfective, and
          preventive requests become real issues and patch releases, with rollback and retirement
          when the time comes.
        </span>
      </div>
    );
  }

  const activeType = TYPES.find((t) => t.id === type)!;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, type, title: title.trim(), description: description.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed with HTTP ${res.status}`);
      setFiled((prev) => [{ number: data.number, url: data.url, title: title.trim(), type }, ...prev]);
      setTitle("");
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to file the issue");
    } finally {
      setSubmitting(false);
    }
  };

  // Run the full maintenance mini-cycle for an issue: fix branch → PR → CI →
  // merge → patch release, polling until the server reports done.
  const runCycle = async (issue: FiledIssue) => {
    cancelRef.current = false;
    const setCycle = (status: CycleStatus) =>
      setCycles((prev) => ({ ...prev, [issue.number]: status }));
    setCycle({ phase: "running", note: "Engineering the fix…", links: [] });
    try {
      let state: unknown;
      for (let poll = 0; poll <= CYCLE_MAX_POLLS; poll++) {
        const res = await fetch("/api/maintenance/cycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo, issueNumber: issue.number, state }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Cycle failed with HTTP ${res.status}`);
        if (data.done) {
          setCycle({ phase: "shipped", note: data.output, links: data.links ?? [] });
          return;
        }
        state = data.state;
        setCycle({ phase: "running", note: data.output, links: data.links ?? [] });
        if (cancelRef.current) return;
        await new Promise((r) => setTimeout(r, CYCLE_POLL_MS));
      }
      throw new Error("Timed out waiting for the maintenance CI to complete");
    } catch (err) {
      setCycle({
        phase: "error",
        note: err instanceof Error ? err.message : "Maintenance cycle failed",
        links: [],
      });
    }
  };

  const runLifecycle = async (action: "rollback" | "retire") => {
    setConfirmRetire(false);
    setLifecycle({
      action,
      phase: "running",
      note: action === "rollback" ? "Restoring the previous release…" : "Archiving the repository…",
      links: [],
    });
    try {
      const res = await fetch(`/api/maintenance/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed with HTTP ${res.status}`);
      setLifecycle({ action, phase: "done", note: data.output, links: data.links ?? [] });
      if (action === "retire") setRetired(true);
    } catch (err) {
      setLifecycle({
        action,
        phase: "error",
        note: err instanceof Error ? err.message : "Action failed",
        links: [],
      });
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="mb-3 text-xs text-slate-400">
        The product is live — maintenance is now an ongoing cycle on{" "}
        <span className="text-slate-300">{repo}</span>. Pick the maintenance type, file it, then
        ship the fix as a real patch release.
      </p>

      {retired ? (
        <p className="rounded-md bg-slate-800/60 px-3 py-2 text-xs text-slate-400">
          This product has been retired — the repository is archived and read-only.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {TYPES.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setType(t.id)}
                  disabled={submitting}
                  title={`${t.kind} maintenance`}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    type === t.id ? t.active : "border-slate-700 text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
          <p className="mb-2 text-[11px] text-slate-500">
            {activeType.kind.charAt(0).toUpperCase() + activeType.kind.slice(1)} maintenance
            {type === "bug" && " — reactive: fix a defect found in production."}
            {type === "adaptive" && " — reactive: keep the app working as its environment changes."}
            {type === "enhancement" && " — proactive: add value based on user feedback."}
            {type === "preventive" && " — proactive: reduce future failures and technical debt."}
          </p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting}
            maxLength={120}
            placeholder={activeType.titlePlaceholder}
            className="mb-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-indigo-500 disabled:opacity-60"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={submitting}
            rows={3}
            maxLength={2000}
            placeholder={activeType.descPlaceholder}
            className="mb-3 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-indigo-500 disabled:opacity-60"
          />
          {error && (
            <p className="mb-3 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>
          )}
          <button
            onClick={submit}
            disabled={submitting || !title.trim()}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
            {submitting ? "Filing…" : "File maintenance issue"}
          </button>
        </>
      )}

      {filed.length > 0 && (
        <ul className="mt-4 space-y-3 border-t border-slate-800 pt-3">
          {filed.map((issue) => {
            const cycle = cycles[issue.number];
            return (
              <li key={issue.number} className="rounded-lg border border-slate-800 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={issue.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 items-center gap-1.5 text-xs text-indigo-300 hover:underline"
                  >
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase ${TYPE_BADGE[issue.type]}`}
                    >
                      {issue.type}
                    </span>
                    <span className="truncate">
                      #{issue.number} {issue.title}
                    </span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  {!retired && (!cycle || cycle.phase === "error") && (
                    <button
                      onClick={() => runCycle(issue)}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-500"
                    >
                      <Rocket className="h-3 w-3" />
                      {cycle?.phase === "error" ? "Retry fix" : "Ship fix"}
                    </button>
                  )}
                  {cycle?.phase === "running" && (
                    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-indigo-300">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      In progress
                    </span>
                  )}
                  {cycle?.phase === "shipped" && (
                    <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase text-emerald-400">
                      shipped
                    </span>
                  )}
                </div>
                {cycle && (
                  <div className="mt-2">
                    <p
                      className={`text-[11px] ${
                        cycle.phase === "error" ? "text-rose-300" : "text-slate-400"
                      }`}
                    >
                      {cycle.note}
                    </p>
                    {cycle.links.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {cycle.links.map((link) => (
                          <a
                            key={`${link.label}-${link.url}`}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300 transition-colors hover:bg-indigo-500/25"
                          >
                            {link.label}
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Lifecycle controls: rollback to the previous release, and retirement */}
      {!retired && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
          <button
            onClick={() => runLifecycle("rollback")}
            disabled={lifecycle?.phase === "running"}
            title="Restore the app files from the previous release and redeploy them"
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/50 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/10 disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Roll back to previous release
          </button>
          {!confirmRetire ? (
            <button
              onClick={() => setConfirmRetire(true)}
              disabled={lifecycle?.phase === "running"}
              title="End of life: archive the repository (read-only)"
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800 disabled:opacity-40"
            >
              <Archive className="h-3.5 w-3.5" />
              Retire product
            </button>
          ) : (
            <span className="flex items-center gap-2 text-xs text-slate-400">
              Archive the repo read-only?
              <button
                onClick={() => runLifecycle("retire")}
                className="rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-rose-500"
              >
                Yes, retire it
              </button>
              <button
                onClick={() => setConfirmRetire(false)}
                className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-800"
              >
                Cancel
              </button>
            </span>
          )}
        </div>
      )}

      {lifecycle && (
        <div className="mt-2">
          <p
            className={`text-[11px] ${
              lifecycle.phase === "error"
                ? "text-rose-300"
                : lifecycle.phase === "running"
                  ? "text-indigo-300"
                  : "text-slate-400"
            }`}
          >
            {lifecycle.phase === "running" && (
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            )}
            {lifecycle.note}
          </p>
          {lifecycle.links.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {lifecycle.links.map((link) => (
                <a
                  key={`${link.label}-${link.url}`}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300 transition-colors hover:bg-indigo-500/25"
                >
                  {link.label}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
