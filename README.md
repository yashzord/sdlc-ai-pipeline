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
- **Demo mode** — with no API key configured, the pipeline serves realistic pre-scripted outputs so the deployed app always works
- **GitHub Actions** — CI (typecheck + build) on every push and PR
- **Vercel** — hosting and deploys

## Run locally

```bash
npm install
cp .env.example .env   # optional: add your key
npm run dev
```

### Going live (free)

1. Create a free API key at [Google AI Studio](https://aistudio.google.com/apikey) — no credit card required.
2. Set `GEMINI_API_KEY` in `.env` locally, or in **Vercel → Project → Settings → Environment Variables** for the deployed app, then redeploy.
3. The header badge flips from **AI: demo mode** to **AI: live**.

Optional: set `GEMINI_MODEL` to pin a model (defaults to `gemini-2.5-flash`, falling back to `gemini-2.0-flash` and `gemini-flash-latest`).

## API

- `POST /api/pipeline` — run one stage. Body: `{ stageId, requirement, context }` → `{ output, mode, model? }`
- `GET /api/health` — `{ status, mode }` where mode is `live` or `demo`

## CI/CD

- `.github/workflows/ci.yml` typechecks and builds on every push/PR to `main`
- Vercel deploys `main` to production; PRs get preview deployments when the repo is linked in Vercel

## Project structure

```
app/
  page.tsx              # pipeline dashboard (client)
  layout.tsx            # root layout + metadata
  api/pipeline/route.ts # stage executor (Gemini or demo)
  api/health/route.ts   # mode probe
components/
  StageCard.tsx         # timeline stage UI
  Markdown.tsx          # safe markdown renderer (no innerHTML)
lib/
  stages.ts             # the 7 stage definitions + prompts
  gemini.ts             # Gemini REST client with model fallback
  demo.ts               # pre-scripted demo outputs
```
