"use client";

import { useState } from "react";
import { Check, ChevronDown, FolderGit2, Loader2, KanbanSquare } from "lucide-react";

export interface MeState {
  ai: boolean;
  oauthConfigured: boolean;
  github: { login: string; avatarUrl: string } | null;
  jira: { site: string; projectKey: string } | null;
  workspace: string | null;
}

export default function SetupPanel({
  me,
  onChanged,
  disabled,
}: {
  me: MeState;
  onChanged: () => void;
  disabled: boolean;
}) {
  const [repoName, setRepoName] = useState(me.workspace?.split("/")[1] ?? "sdlc-workspace");
  const [wsBusy, setWsBusy] = useState(false);
  const [wsError, setWsError] = useState("");
  const [jiraOpen, setJiraOpen] = useState(false);
  const [jiraBusy, setJiraBusy] = useState(false);
  const [jiraError, setJiraError] = useState("");
  const [jiraForm, setJiraForm] = useState({ site: "", email: "", apiToken: "", projectKey: "" });

  const setupWorkspace = async () => {
    setWsBusy(true);
    setWsError("");
    try {
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onChanged();
    } catch (err) {
      setWsError(err instanceof Error ? err.message : "Workspace setup failed");
    } finally {
      setWsBusy(false);
    }
  };

  const connectJira = async () => {
    setJiraBusy(true);
    setJiraError("");
    try {
      const res = await fetch("/api/jira", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jiraForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setJiraOpen(false);
      onChanged();
    } catch (err) {
      setJiraError(err instanceof Error ? err.message : "Jira connect failed");
    } finally {
      setJiraBusy(false);
    }
  };

  const disconnectJira = async () => {
    await fetch("/api/jira", { method: "DELETE" });
    onChanged();
  };

  const inputCls =
    "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-indigo-500 disabled:opacity-60";

  return (
    <section className="mb-6 grid gap-3 sm:grid-cols-2">
      {/* Workspace */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <FolderGit2 className="h-4 w-4 text-indigo-400" />
          Workspace repo
          {me.workspace && <Check className="h-4 w-4 text-emerald-400" />}
        </div>
        {me.workspace ? (
          <p className="text-xs text-slate-400">
            Pipeline operates on{" "}
            <a
              href={`https://github.com/${me.workspace}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-indigo-300 hover:underline"
            >
              {me.workspace}
            </a>
            . Branches, PRs, CI runs, and releases land here.
          </p>
        ) : (
          <p className="mb-2 text-xs text-slate-500">
            The repo the pipeline will work in. It's created and bootstrapped (Vitest + CI) in your
            account if it doesn't exist.
          </p>
        )}
        {!me.workspace && (
          <div className="mt-2 flex gap-2">
            <input
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              disabled={disabled || wsBusy}
              placeholder="sdlc-workspace"
              className={inputCls}
            />
            <button
              onClick={setupWorkspace}
              disabled={disabled || wsBusy || !repoName.trim()}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-40"
            >
              {wsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set up"}
            </button>
          </div>
        )}
        {wsError && <p className="mt-2 text-xs text-rose-400">{wsError}</p>}
      </div>

      {/* Jira */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <KanbanSquare className="h-4 w-4 text-sky-400" />
            Jira <span className="text-xs font-normal text-slate-500">(optional)</span>
            {me.jira && <Check className="h-4 w-4 text-emerald-400" />}
          </div>
          {me.jira ? (
            <button
              onClick={disconnectJira}
              disabled={disabled}
              className="text-xs text-slate-500 hover:text-rose-400"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => setJiraOpen((o) => !o)}
              disabled={disabled}
              className="flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200"
            >
              Connect
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${jiraOpen ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>
        {me.jira ? (
          <p className="text-xs text-slate-400">
            Epics and stories go to project <span className="font-medium">{me.jira.projectKey}</span>{" "}
            on {me.jira.site.replace("https://", "")}.
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            Without Jira, epics and stories are created as GitHub Issues in the workspace repo.
          </p>
        )}
        {jiraOpen && !me.jira && (
          <div className="mt-3 space-y-2">
            <input
              value={jiraForm.site}
              onChange={(e) => setJiraForm({ ...jiraForm, site: e.target.value })}
              placeholder="https://your-team.atlassian.net"
              className={inputCls}
            />
            <input
              value={jiraForm.email}
              onChange={(e) => setJiraForm({ ...jiraForm, email: e.target.value })}
              placeholder="you@email.com"
              className={inputCls}
            />
            <input
              value={jiraForm.projectKey}
              onChange={(e) =>
                setJiraForm({ ...jiraForm, projectKey: e.target.value.toUpperCase() })
              }
              placeholder="Project key (e.g. SDLC)"
              className={inputCls}
            />
            <input
              value={jiraForm.apiToken}
              onChange={(e) => setJiraForm({ ...jiraForm, apiToken: e.target.value })}
              type="password"
              placeholder="API token (id.atlassian.com → Security → API tokens)"
              className={inputCls}
            />
            <button
              onClick={connectJira}
              disabled={jiraBusy}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-40"
            >
              {jiraBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validate & connect"}
            </button>
            {jiraError && <p className="text-xs text-rose-400">{jiraError}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
