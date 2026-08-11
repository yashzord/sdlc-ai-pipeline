"use client";

import { useState } from "react";
import { Check, ChevronDown, Loader2, KanbanSquare, Triangle } from "lucide-react";

export interface MeState {
  ai: boolean;
  oauthConfigured: boolean;
  github: { login: string; avatarUrl: string } | null;
  jira: { site: string; projectKey: string } | null;
  vercel: boolean;
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
  const [jiraOpen, setJiraOpen] = useState(false);
  const [jiraBusy, setJiraBusy] = useState(false);
  const [jiraError, setJiraError] = useState("");
  const [jiraForm, setJiraForm] = useState({ site: "", email: "", apiToken: "", projectKey: "" });
  const [vercelOpen, setVercelOpen] = useState(false);
  const [vercelBusy, setVercelBusy] = useState(false);
  const [vercelError, setVercelError] = useState("");
  const [vercelToken, setVercelToken] = useState("");

  const connect = async (
    url: string,
    payload: unknown,
    setBusy: (b: boolean) => void,
    setError: (e: string) => void,
    close: () => void
  ) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      close();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (url: string) => {
    await fetch(url, { method: "DELETE" });
    onChanged();
  };

  const inputCls =
    "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-indigo-500 disabled:opacity-60";

  return (
    <section className="mb-6 grid gap-3 sm:grid-cols-2">
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
              onClick={() => disconnect("/api/jira")}
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
            Without Jira, epics and stories are created as GitHub Issues in your product's repo.
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
              onClick={() =>
                connect("/api/jira", jiraForm, setJiraBusy, setJiraError, () => setJiraOpen(false))
              }
              disabled={jiraBusy}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-40"
            >
              {jiraBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validate & connect"}
            </button>
            {jiraError && <p className="text-xs text-rose-400">{jiraError}</p>}
          </div>
        )}
      </div>

      {/* Vercel */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Triangle className="h-4 w-4 text-slate-200" />
            Vercel <span className="text-xs font-normal text-slate-500">(optional)</span>
            {me.vercel && <Check className="h-4 w-4 text-emerald-400" />}
          </div>
          {me.vercel ? (
            <button
              onClick={() => disconnect("/api/vercel")}
              disabled={disabled}
              className="text-xs text-slate-500 hover:text-rose-400"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => setVercelOpen((o) => !o)}
              disabled={disabled}
              className="flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200"
            >
              Connect
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${vercelOpen ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>
        {me.vercel ? (
          <p className="text-xs text-slate-400">
            Releases also deploy to your Vercel account, alongside GitHub Pages.
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            Every product deploys to GitHub Pages automatically. Connect Vercel to additionally get
            a Vercel deployment per release.
          </p>
        )}
        {vercelOpen && !me.vercel && (
          <div className="mt-3 space-y-2">
            <input
              value={vercelToken}
              onChange={(e) => setVercelToken(e.target.value)}
              type="password"
              placeholder="Access token (vercel.com/account/settings/tokens)"
              className={inputCls}
            />
            <button
              onClick={() =>
                connect(
                  "/api/vercel",
                  { token: vercelToken },
                  setVercelBusy,
                  setVercelError,
                  () => setVercelOpen(false)
                )
              }
              disabled={vercelBusy || !vercelToken.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-white disabled:opacity-40"
            >
              {vercelBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validate & connect"}
            </button>
            {vercelError && <p className="text-xs text-rose-400">{vercelError}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
