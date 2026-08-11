# SDLC AI Pipeline

**Live: [sdlc-ai-pipeline.vercel.app](https://sdlc-ai-pipeline.vercel.app)**

Type a product idea. AI agents ship it — for real. Each idea gets **its own GitHub repo** on your account, real tickets, a reviewed pull request, tests running in CI, and when it releases, **a live app link on GitHub Pages**. Zero setup beyond signing in with GitHub.

```
Idea ─▶ Repo+Epic ─▶ Stories ─▶ Branch+Design ─▶ App+PR ─▶ Review ─▶ Rework? ─▶ Tests+CI ─▶ Merge+Release+Deploy
                                                                                            └─▶ 🌐 username.github.io/your-idea
```

## What each stage actually does

| # | Stage | Real action |
|---|-------|-------------|
| 1 | Requirements Analysis | Writes the requirements doc, **creates the product's repo** (Vite scaffold, CI, Pages deploy workflow), opens the **Epic** (Jira or GitHub Issues) |
| 2 | User Stories | Creates estimated **tickets** with acceptance criteria |
| 3 | Architecture | Cuts `feature/build`, commits `docs/ARCHITECTURE.md` |
| 4 | Implementation | Builds a **working client-side app** (`index.html` + `src/main.ts` + `src/app.ts`), opens a **pull request**, moves tickets to In Progress |
| 5 | Code Review | Reviews the **actual PR diff**, posts the review on the PR |
| 6 | Rework *(conditional)* | On REQUEST CHANGES: fixes the findings, pushes to the PR, posts a **re-review**; skipped when approved |
| 7 | Test Engineering | Commits Vitest tests for the logic core → **GitHub Actions runs them** |
| 8 | Release & Deploy | Waits for green CI, **squash-merges**, publishes a **GitHub Release (v1.0.0)**, closes the tickets, then waits for the **GitHub Pages deploy** and surfaces the **live URL** |

If CI fails, the release blocks. Failed stages offer "retry from here" (idempotent — existing repos/branches/PRs/releases are reused). AI rate limits and mobile network drops auto-retry.

## Integrations (all per-user, no server config)

- **GitHub** (required): OAuth sign-in with `repo workflow` scopes. Tokens sealed with AES-256-GCM into httpOnly cookies — no database.
- **AI** (optional): shared Gemini default out of the box; one-click **Connect with OpenRouter** (OAuth PKCE — no key pasting, hundreds of models), or paste your own **Gemini / Claude / Groq / OpenRouter** key as an advanced option. Built on the [Vercel AI SDK](https://ai-sdk.dev) with Zod-validated structured output.
- **Jira** (optional): one-click **Connect Jira** via Atlassian OAuth (3LO) with auto-refreshed tokens and an in-app project picker — or paste an API token as an advanced option. Without Jira, GitHub Issues are used.
- **Vercel** (optional): one-click **Connect Vercel** via a Vercel integration — or paste an [access token](https://vercel.com/account/settings/tokens). Every release then additionally deploys to your Vercel account; GitHub Pages remains the zero-config default.

## What gets built

Each idea ships as a self-contained client-side web app:

```
your-idea/
  index.html            # complete UI, inline styles, dark theme
  src/app.ts            # logic core — standalone TS, zero imports (what the tests cover)
  src/main.ts           # DOM wiring
  src/app.test.ts       # AI-written Vitest tests (gate the merge in CI)
  docs/ARCHITECTURE.md  # the design doc
  .github/workflows/    # ci.yml (PR gate) + deploy.yml (Pages deploy on main)
```

## Owner setup (deployment env vars)

| Var | What |
|---|---|
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | A [GitHub OAuth app](https://github.com/settings/developers). Callback: `https://<domain>/api/auth/callback` |
| `SESSION_SECRET` | 32+ random chars; encrypts session cookies |
| `GEMINI_API_KEY` | Shared default AI ([Google AI Studio](https://aistudio.google.com/apikey)) |
| `GEMINI_MODEL` | Optional model override |
| `JIRA_CLIENT_ID` / `JIRA_CLIENT_SECRET` | *(optional)* [Atlassian 3LO app](https://developer.atlassian.com/console/myapps) → enables one-click Connect Jira. Callback: `https://<domain>/api/jira/oauth/callback`, scopes `read:jira-work write:jira-work read:me offline_access` |
| `VERCEL_INTEGRATION_SLUG` / `VERCEL_CLIENT_ID` / `VERCEL_CLIENT_SECRET` | *(optional)* [Vercel integration](https://vercel.com/dashboard/integrations/console) → enables one-click Connect Vercel. Redirect: `https://<domain>/api/vercel/oauth/callback` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | *(optional)* Supabase project → enables **run persistence**: refresh-proof runs, resume, and per-user run history (`sdlc_runs` / `sdlc_stage_results` tables, service-role only, scoped by GitHub login) |

OpenRouter's one-click AI connect needs no configuration at all (PKCE).

## Run locally

```bash
npm install
cp .env.example .env   # fill in the vars above (callback http://localhost:3000/api/auth/callback)
npm run dev
```

## API surface

- `GET /api/auth/login|callback`, `POST /api/auth/logout` — GitHub OAuth
- `GET /api/me` — connection status
- `POST|DELETE /api/ai` — BYOK AI provider (gemini / anthropic / groq / openrouter)
- `POST|DELETE /api/jira`, `POST|DELETE /api/vercel` — optional integrations
- `POST /api/pipeline` — execute one stage `{ stageId, requirement, artifacts }` → `{ output, links, artifacts, model, pending? }`
- `GET /api/health` — server config probe

## Project structure

```
app/
  page.tsx                # control panel: auth gate, connections, pipeline run
  api/                    # auth, me, jira, vercel, pipeline routes
components/
  SetupPanel.tsx          # Jira + Vercel connect UI
  StageCard.tsx           # stage timeline card with artifact links
  Markdown.tsx            # safe markdown renderer (no innerHTML)
lib/
  pipeline.ts             # the 8 stage orchestrations (AI + real side effects)
  stages.ts               # stage metadata
  ai.ts                   # provider-agnostic AI layer (Vercel AI SDK: Gemini/Claude/Groq/OpenRouter, Zod schemas)
  github.ts               # GitHub REST client (repos, PRs, reviews, checks, Pages, releases)
  jira.ts                 # Jira REST client + markdown→ADF
  vercel.ts               # Vercel deployments client
  crypto.ts / session.ts  # AES-GCM sealed cookie sessions
```
