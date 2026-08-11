# SDLC AI Pipeline

**Live: [sdlc-ai-pipeline.vercel.app](https://sdlc-ai-pipeline.vercel.app)**

An AI-automated software delivery lifecycle that operates on **real systems**. Sign in with GitHub, describe a feature, and seven AI agents ship it: real tickets, a real branch and pull request, a posted code review, tests that run in real CI, and a published release.

```
Idea ─▶ Epic ─▶ Stories ─▶ Branch+Design ─▶ Code+PR ─▶ PR Review ─▶ Tests+CI ─▶ Merge+Release
        Jira /  Jira /     feature/*        real PR    posted on    Vitest on   squash merge,
        Issues  Issues     ARCHITECTURE.md            the PR       GH Actions  GitHub Release
```

## What each stage actually does

| # | Stage | Real action |
|---|-------|-------------|
| 1 | Requirements Analysis | Writes the requirements doc, opens a **Jira Epic** (or GitHub epic issue) |
| 2 | User Stories | Creates estimated **Jira Stories / GitHub Issues** with acceptance criteria |
| 3 | Architecture | Cuts `feature/<slug>` branch, commits `docs/<slug>/ARCHITECTURE.md` |
| 4 | Implementation | Commits a TypeScript module, opens a **pull request**, moves tickets to In Progress |
| 5 | Code Review | Reviews the **actual PR diff**, posts the review on the PR |
| 6 | Test Engineering | Commits Vitest tests to the branch → **GitHub Actions runs them** |
| 7 | Release | Polls CI; when green: **squash-merges the PR**, publishes a **GitHub Release**, closes the tickets |

If CI fails, the release stage blocks — exactly like a real pipeline. Failed stages offer "retry from here."

## How users connect (no server config per user)

- **GitHub**: OAuth sign-in (`repo` scope). The token is sealed with AES-256-GCM into an httpOnly cookie — no database, nothing stored server-side.
- **Workspace**: users pick a repo name; the app creates and bootstraps it (Vitest, tsconfig, CI workflow) in their account via their token.
- **Jira (optional)**: users paste their site URL, email, API token ([id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens)) and project key; validated against `/rest/api/3/myself`, then sealed into a cookie. Without Jira, ticketing falls back to GitHub Issues — the flow stays real either way.

## Owner setup (deployment env vars)

| Var | What |
|---|---|
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | A [GitHub OAuth app](https://github.com/settings/developers). Callback URL: `https://<your-domain>/api/auth/callback` |
| `SESSION_SECRET` | 32+ random chars; encrypts session cookies. Rotating it signs everyone out |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) key powering the agents |
| `GEMINI_MODEL` | Optional model override (defaults to `gemini-2.5-flash` with fallbacks) |

## Run locally

```bash
npm install
cp .env.example .env   # fill in the vars above (callback URL http://localhost:3000/api/auth/callback)
npm run dev
```

## API surface

- `GET /api/auth/login` → GitHub OAuth; `GET /api/auth/callback`; `POST /api/auth/logout`
- `GET /api/me` — connection status (GitHub / Jira / workspace / AI)
- `POST /api/workspace` — create + bootstrap the workspace repo
- `POST /api/jira` / `DELETE /api/jira` — connect/disconnect Jira
- `POST /api/pipeline` — execute one stage `{ stageId, requirement, artifacts }` → `{ output, links, artifacts, model, pending? }`
- `GET /api/health` — server config probe

## Project structure

```
app/
  page.tsx                # control panel: auth gate, setup, pipeline run
  api/auth/*              # GitHub OAuth flow
  api/me|workspace|jira   # connection management
  api/pipeline/route.ts   # stage executor
components/
  SetupPanel.tsx          # workspace + Jira connect UI
  StageCard.tsx           # stage timeline card with artifact links
  Markdown.tsx            # safe markdown renderer (no innerHTML)
lib/
  pipeline.ts             # the 7 stage orchestrations (AI + real side effects)
  stages.ts               # stage metadata
  github.ts               # GitHub REST client (branches, PRs, reviews, checks, releases)
  jira.ts                 # Jira REST client + markdown→ADF
  gemini.ts               # Gemini client with retry, model fallback, JSON mode
  crypto.ts / session.ts  # AES-GCM sealed cookie sessions
```

## CI/CD of this repo itself

GitHub Actions typechecks and builds every push/PR; Vercel auto-deploys `main` to production and gives PRs preview URLs.
