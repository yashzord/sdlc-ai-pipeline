"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Loader2, KanbanSquare, Sparkles, Triangle } from "lucide-react";

export interface MeState {
  serverAi: boolean;
  byokAi: { provider: string; model: string } | null;
  oauthConfigured: boolean;
  oauthAvailable: { jira: boolean; vercel: boolean };
  github: { login: string; avatarUrl: string } | null;
  jira: { site: string; projectKey: string | null } | null;
  vercel: boolean;
}

const AI_PROVIDERS = [
  { id: "gemini", label: "Google Gemini", keyHint: "aistudio.google.com/apikey" },
  { id: "anthropic", label: "Anthropic Claude", keyHint: "console.anthropic.com" },
  { id: "groq", label: "Groq", keyHint: "console.groq.com/keys" },
  { id: "openrouter", label: "OpenRouter", keyHint: "openrouter.ai/keys" },
];

const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-indigo-500 disabled:opacity-60";

function AdvancedToggle({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1 text-[11px] text-slate-500 transition-colors hover:text-slate-300"
    >
      {label}
      <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
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
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiForm, setAiForm] = useState({ provider: "gemini", apiKey: "", model: "" });

  const [jiraOpen, setJiraOpen] = useState(false);
  const [jiraBusy, setJiraBusy] = useState(false);
  const [jiraError, setJiraError] = useState("");
  const [jiraForm, setJiraForm] = useState({ site: "", email: "", apiToken: "", projectKey: "" });
  const [projects, setProjects] = useState<Array<{ key: string; name: string }> | null>(null);
  const [projectChoice, setProjectChoice] = useState("");
  const [projectBusy, setProjectBusy] = useState(false);

  const [vercelOpen, setVercelOpen] = useState(false);
  const [vercelBusy, setVercelBusy] = useState(false);
  const [vercelError, setVercelError] = useState("");
  const [vercelToken, setVercelToken] = useState("");

  const needsProject = Boolean(me.jira && !me.jira.projectKey);

  useEffect(() => {
    if (needsProject && projects === null) {
      fetch("/api/jira/projects")
        .then((r) => r.json())
        .then((d) => setProjects(d.projects ?? []))
        .catch(() => setProjects([]));
    }
  }, [needsProject, projects]);

  const connect = useCallback(
    async (
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
    },
    [onChanged]
  );

  const disconnect = async (url: string) => {
    await fetch(url, { method: "DELETE" });
    setProjects(null);
    onChanged();
  };

  const saveProject = async () => {
    if (!projectChoice) return;
    setProjectBusy(true);
    try {
      await fetch("/api/jira", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectKey: projectChoice }),
      });
      onChanged();
    } finally {
      setProjectBusy(false);
    }
  };

  const connectBtn =
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors";

  return (
    <section className="mb-6 grid gap-3 sm:grid-cols-2">
      {/* AI provider (BYOK) */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:col-span-2">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Sparkles className="h-4 w-4 text-indigo-400" />
            AI Provider
            {me.byokAi && <Check className="h-4 w-4 text-emerald-400" />}
          </div>
          {me.byokAi && (
            <button
              onClick={() => disconnect("/api/ai")}
              disabled={disabled}
              className="text-xs text-slate-500 hover:text-rose-400"
            >
              Use default
            </button>
          )}
        </div>
        {me.byokAi ? (
          <p className="text-xs text-slate-400">
            Using your key: <span className="font-medium">{me.byokAi.provider}</span> ·{" "}
            {me.byokAi.model}. Your quota, your limits.
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-500">
              {me.serverAi
                ? "Using the app's built-in Gemini (shared free-tier quota — may rate-limit). One click below gets you your own quota and access to hundreds of models."
                : "No built-in AI is configured — connect a provider below to run the pipeline."}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="/api/ai/oauth/login"
                className={`${connectBtn} bg-indigo-600 text-white hover:bg-indigo-500`}
              >
                Connect with OpenRouter
              </a>
              <AdvancedToggle
                open={aiOpen}
                onToggle={() => setAiOpen((o) => !o)}
                label="Advanced: paste an API key"
              />
            </div>
            {aiOpen && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {AI_PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setAiForm({ ...aiForm, provider: p.id })}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        aiForm.provider === p.id
                          ? "border-indigo-500 bg-indigo-500/15 text-indigo-200"
                          : "border-slate-700 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <input
                  value={aiForm.apiKey}
                  onChange={(e) => setAiForm({ ...aiForm, apiKey: e.target.value })}
                  type="password"
                  placeholder={`API key (${AI_PROVIDERS.find((p) => p.id === aiForm.provider)?.keyHint})`}
                  className={inputCls}
                />
                <input
                  value={aiForm.model}
                  onChange={(e) => setAiForm({ ...aiForm, model: e.target.value })}
                  placeholder="Model (optional — sensible default per provider)"
                  className={inputCls}
                />
                <button
                  onClick={() =>
                    connect("/api/ai", aiForm, setAiBusy, setAiError, () => setAiOpen(false))
                  }
                  disabled={aiBusy || !aiForm.apiKey.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-40"
                >
                  {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validate & use"}
                </button>
                {aiError && <p className="text-xs text-rose-400">{aiError}</p>}
              </div>
            )}
          </>
        )}
      </div>

      {/* Jira */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <KanbanSquare className="h-4 w-4 text-sky-400" />
            Jira <span className="text-xs font-normal text-slate-500">(optional)</span>
            {me.jira?.projectKey && <Check className="h-4 w-4 text-emerald-400" />}
          </div>
          {me.jira && (
            <button
              onClick={() => disconnect("/api/jira")}
              disabled={disabled}
              className="text-xs text-slate-500 hover:text-rose-400"
            >
              Disconnect
            </button>
          )}
        </div>

        {me.jira?.projectKey ? (
          <p className="text-xs text-slate-400">
            Epics and stories go to project <span className="font-medium">{me.jira.projectKey}</span>{" "}
            on {me.jira.site.replace("https://", "")}.
          </p>
        ) : needsProject ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">
              Connected to {me.jira!.site.replace("https://", "")} — pick the project to use:
            </p>
            {projects === null ? (
              <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
            ) : (
              <div className="flex gap-2">
                <select
                  value={projectChoice}
                  onChange={(e) => setProjectChoice(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Select a project…</option>
                  {projects.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.key} — {p.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={saveProject}
                  disabled={!projectChoice || projectBusy}
                  className="shrink-0 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-40"
                >
                  {projectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-500">
              Without Jira, epics and stories are created as GitHub Issues in your product's repo.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {me.oauthAvailable.jira && (
                <a
                  href="/api/jira/oauth/login"
                  className={`${connectBtn} bg-sky-600 text-white hover:bg-sky-500`}
                >
                  Connect Jira
                </a>
              )}
              <AdvancedToggle
                open={jiraOpen}
                onToggle={() => setJiraOpen((o) => !o)}
                label={me.oauthAvailable.jira ? "Advanced: API token" : "Connect with API token"}
              />
            </div>
            {jiraOpen && (
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
                    connect("/api/jira", jiraForm, setJiraBusy, setJiraError, () =>
                      setJiraOpen(false)
                    )
                  }
                  disabled={jiraBusy}
                  className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-40"
                >
                  {jiraBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validate & connect"}
                </button>
                {jiraError && <p className="text-xs text-rose-400">{jiraError}</p>}
              </div>
            )}
          </>
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
          {me.vercel && (
            <button
              onClick={() => disconnect("/api/vercel")}
              disabled={disabled}
              className="text-xs text-slate-500 hover:text-rose-400"
            >
              Disconnect
            </button>
          )}
        </div>
        {me.vercel ? (
          <p className="text-xs text-slate-400">
            Releases also deploy to your Vercel account, alongside GitHub Pages.
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-500">
              Every product deploys to GitHub Pages automatically. Connect Vercel to additionally
              get a Vercel deployment per release.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {me.oauthAvailable.vercel && (
                <a
                  href="/api/vercel/oauth/login"
                  className={`${connectBtn} bg-slate-200 text-slate-900 hover:bg-white`}
                >
                  Connect Vercel
                </a>
              )}
              <AdvancedToggle
                open={vercelOpen}
                onToggle={() => setVercelOpen((o) => !o)}
                label={me.oauthAvailable.vercel ? "Advanced: access token" : "Connect with token"}
              />
            </div>
            {vercelOpen && (
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
          </>
        )}
      </div>
    </section>
  );
}
