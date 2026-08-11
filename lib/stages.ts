export type StageId =
  | "requirements"
  | "stories"
  | "architecture"
  | "code"
  | "review"
  | "tests"
  | "release";

export interface StageDef {
  id: StageId;
  title: string;
  role: string;
  description: string;
  system: string;
  buildPrompt: (requirement: string, context: string) => string;
}

const SHARED_RULES = `You are one specialist agent inside an automated SDLC pipeline.
Respond in clean GitHub-flavored markdown. Be concrete and specific to the product described — never generic filler.
Keep the response focused and under ~500 words unless code is required.`;

export const STAGES: StageDef[] = [
  {
    id: "requirements",
    title: "Requirements Analysis",
    role: "Business Analyst",
    description: "Turns the raw idea into functional & non-functional requirements",
    system: `${SHARED_RULES}
You are a senior business analyst. Extract structured requirements from a raw product idea.`,
    buildPrompt: (requirement) => `Raw product idea:

"${requirement}"

Produce:
## Functional Requirements
Numbered FR-1, FR-2... with a one-line rationale each (5-8 items).
## Non-Functional Requirements
Numbered NFR-1... covering performance, security, accessibility, scalability (4-6 items).
## Out of Scope
3 things explicitly excluded from v1.
## Open Questions
3 questions a PM should answer before build starts.`,
  },
  {
    id: "stories",
    title: "User Stories & Backlog",
    role: "Product Owner",
    description: "Breaks requirements into estimated, sprint-ready stories",
    system: `${SHARED_RULES}
You are a product owner writing sprint-ready user stories.`,
    buildPrompt: (requirement, context) => `Product idea: "${requirement}"

Requirements from the previous pipeline stage:
${context}

Produce:
## Epic
One-line epic statement.
## User Stories
5-7 stories in the format:
**US-n — Title** (points: 1/2/3/5/8)
As a <role>, I want <capability> so that <benefit>.
Acceptance criteria: 2-3 bullet points each.
## Sprint Plan
Split the stories into Sprint 1 (MVP) and Sprint 2.`,
  },
  {
    id: "architecture",
    title: "Architecture & Design",
    role: "Software Architect",
    description: "Proposes system design, tech stack, and API contracts",
    system: `${SHARED_RULES}
You are a pragmatic software architect. Prefer boring, proven technology.`,
    buildPrompt: (requirement, context) => `Product idea: "${requirement}"

Backlog from the previous pipeline stage:
${context}

Produce:
## System Overview
Short paragraph + a mermaid-style component list (Client → API → DB etc. as an indented text diagram).
## Tech Stack
Table: layer | choice | why.
## Data Model
Key entities with fields.
## API Design
4-6 endpoints: METHOD /path — purpose, request/response shape in one line each.
## Key Risks
3 technical risks with mitigations.`,
  },
  {
    id: "code",
    title: "Code Generation",
    role: "Senior Engineer",
    description: "Implements the core module from the design",
    system: `${SHARED_RULES}
You are a senior engineer. Write production-quality, idiomatic TypeScript.`,
    buildPrompt: (requirement, context) => `Product idea: "${requirement}"

Architecture from the previous pipeline stage:
${context}

Implement the SINGLE most central module of this system in TypeScript (~60-100 lines):
- Pick the module that carries the core business logic.
- Include types/interfaces, the main class or functions, and error handling.
- Precede the code with a 2-3 sentence note on what you chose and why.
- One fenced \`\`\`typescript block only.`,
  },
  {
    id: "review",
    title: "AI Code Review",
    role: "Staff Engineer / Reviewer",
    description: "Reviews the generated code for bugs, risks, and style",
    system: `${SHARED_RULES}
You are a rigorous staff engineer doing code review. Be direct; praise nothing that isn't earned.`,
    buildPrompt: (requirement, context) => `Product idea: "${requirement}"

Code produced by the previous pipeline stage:
${context}

Produce:
## Verdict
APPROVE / APPROVE WITH COMMENTS / REQUEST CHANGES, one-line justification.
## Findings
Numbered findings, each tagged [bug] [risk] [style] [perf] with severity (high/med/low), the offending line or pattern, and a concrete fix.
## Security Notes
Anything an attacker could abuse.
## Test Focus
3 areas the test stage must cover.`,
  },
  {
    id: "tests",
    title: "Test Generation",
    role: "QA Engineer",
    description: "Generates unit tests targeting review findings",
    system: `${SHARED_RULES}
You are a QA automation engineer. Write tests that would actually fail on real bugs.`,
    buildPrompt: (requirement, context) => `Product idea: "${requirement}"

Code and review findings from previous pipeline stages:
${context}

Produce:
## Test Strategy
2-3 sentences: what you're testing and why.
## Unit Tests
One fenced \`\`\`typescript block of Vitest tests (describe/it/expect) covering the happy path, edge cases, and every high-severity review finding. 6-10 test cases.
## Coverage Gaps
What these tests still don't cover.`,
  },
  {
    id: "release",
    title: "Release & Ops",
    role: "Release Manager",
    description: "Writes release notes and a deployment checklist",
    system: `${SHARED_RULES}
You are a release manager preparing a v0.1.0 release.`,
    buildPrompt: (requirement, context) => `Product idea: "${requirement}"

Summary of what the pipeline produced:
${context}

Produce:
## Release Notes — v0.1.0
User-facing highlights (bullets), known limitations.
## Deployment Checklist
Ordered checkboxes (- [ ]) from pre-deploy to post-deploy verification, including rollback trigger criteria.
## Monitoring
3 metrics/alerts to set up on day one.`,
  },
];

export const STAGE_MAP: Record<StageId, StageDef> = Object.fromEntries(
  STAGES.map((s) => [s.id, s])
) as Record<StageId, StageDef>;
