# SDLC AI Pipeline

**Live: [sdlc-ai-pipeline.vercel.app](https://sdlc-ai-pipeline.vercel.app)**

An end-to-end demonstration of **AI-automated software delivery**: type a product idea, and seven specialist AI agents take it through the full software development lifecycle — the same stages a real engineering org runs, in the same order.

```
Idea ──▶ Requirements ──▶ User Stories ──▶ Architecture ──▶ Code ──▶ Review ──▶ Tests ──▶ Release
         Business          Product           Software        Senior     Staff      QA        Release
         Analyst           Owner             Architect       Engineer   Engineer   Engineer  Manager
```

Each stage is a separate AI call with its own role, prompt, and the accumulated context of every previous stage — requirements feed the stories, the architecture feeds the code, the review findings feed the tests.

## Stages

| # | Stage | Role | Produces |
|---|-------|------|----------|
| 1 | Requirements Analysis | Business Analyst | Functional/non-functional requirements, scope, open questions |
| 2 | User Stories & Backlog | Product Owner | Estimated stories with acceptance criteria, sprint plan |
| 3 | Architecture & Design | Software Architect | System design, tech stack, data model, API contracts, risks |
| 4 | Code Generation | Senior Engineer | The core module implemented in TypeScript |
| 5 | AI Code Review | Staff Engineer | Verdict, tagged findings, security notes, test focus |
| 6 | Test Generation | QA Engineer | Vitest unit tests targeting the review findings |
| 7 | Release & Ops | Release Manager | Release notes, deployment checklist, monitoring plan |

## Tech

- **Next.js (App Router)** — UI and API in one deployable
- **Google Gemini** — free-tier LLM powering every stage (REST API, no SDK)
- **GitHub Actions** — CI (typecheck + build) on every push and PR
- **Vercel** — hosting and deploys

## Run locally

```bash
npm install
cp .env.example .env   # add your key — required
npm run dev
```

### API key (free, required)

1. Create a free API key at [Google AI Studio](https://aistudio.google.com/apikey) — no credit card required.
2. Set `GEMINI_API_KEY` in `.env` locally, or in **Vercel → Project → Settings → Environment Variables** for the deployed app, then redeploy.

Without a key the header badge shows **AI: no key** and pipeline runs return an error (503) — there is no canned fallback output.

Optional: set `GEMINI_MODEL` to pin a model (defaults to `gemini-2.5-flash`, falling back to `gemini-2.0-flash` and `gemini-flash-latest`).

## API

- `POST /api/pipeline` — run one stage. Body: `{ stageId, requirement, context }` → `{ output, model }`; errors: 503 when no key is configured, 502 when generation fails
- `GET /api/health` — `{ status, mode }` where mode is `live` or `unconfigured`

## CI/CD

- `.github/workflows/ci.yml` typechecks and builds on every push/PR to `main`
- Vercel deploys `main` to production; PRs get preview deployments when the repo is linked in Vercel

## Project structure

```
app/
  page.tsx              # pipeline dashboard (client)
  layout.tsx            # root layout + metadata
  api/pipeline/route.ts # stage executor (Gemini)
  api/health/route.ts   # key-configured probe
components/
  StageCard.tsx         # timeline stage UI
  Markdown.tsx          # safe markdown renderer (no innerHTML)
lib/
  stages.ts             # the 7 stage definitions + prompts
  gemini.ts             # Gemini REST client with model fallback
```
