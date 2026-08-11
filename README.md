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
- **Jira** (optional): site + email + API token + project key; epics/stories become Jira issues and get transitioned through the flow. Without it, GitHub Issues are used.
- **Vercel** (optional): paste an [access token](https://vercel.com/account/settings/tokens); every release additionally deploys to your Vercel account. GitHub Pages remains the zero-config default.

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
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) key powering the agents |
| `GEMINI_MODEL` | Optional model override |

## Run locally

```bash
npm install
cp .env.example .env   # fill in the vars above (callback http://localhost:3000/api/auth/callback)
npm run dev
```

## API surface

- `GET /api/auth/login|callback`, `POST /api/auth/logout` — GitHub OAuth
- `GET /api/me` — connection status
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
  github.ts               # GitHub REST client (repos, PRs, reviews, checks, Pages, releases)
  jira.ts                 # Jira REST client + markdown→ADF
  vercel.ts               # Vercel deployments client
  gemini.ts               # Gemini client: retry, model fallback, strict JSON mode
  crypto.ts / session.ts  # AES-GCM sealed cookie sessions
```
