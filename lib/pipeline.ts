import { z } from "zod";
import type { StageId } from "./stages";
import type { GithubSession, JiraSession, VercelSession } from "./session";
import { aiJson, aiText, CODE_OUTPUT_TOKENS, type AIConfig } from "./ai";
import {
  GithubError,
  closeIssue,
  commitFile,
  createBranch,
  createIssue,
  createPullRequest,
  createPullRequestReview,
  createRelease,
  createRepo,
  enablePages,
  findOpenPullRequest,
  getBranchSha,
  getCheckRuns,
  getPullRequest,
  getJobLog,
  getPullRequestFiles,
  latestWorkflowRun,
  listRepoFiles,
  listWorkflowJobs,
  mergePullRequest,
  parseRepo,
  readFileContent,
  type RepoRef,
} from "./github";
import { createJiraIssue, transitionJiraIssue } from "./jira";
import { createVercelDeployment, getVercelDeployment } from "./vercel";

export interface ArtifactLink {
  label: string;
  url: string;
}

export interface TicketRef {
  title: string;
  url: string;
  jiraKey?: string;
  issueNumber?: number;
}

export interface Artifacts {
  planVerdict?: "GO" | "NO-GO";
  planningDoc?: string;
  openQuestions?: string[];
  clarifications?: string;
  designApproved?: boolean;
  releaseApproved?: boolean;
  slug?: string;
  featureTitle?: string;
  repo?: string; // owner/name of the idea's own repository
  repoUrl?: string;
  pagesUrl?: string;
  epic?: TicketRef;
  stories?: TicketRef[];
  branch?: string;
  defaultBranch?: string;
  moduleSource?: string; // src/app.ts — the logic core under test
  prNumber?: number;
  prUrl?: string;
  headSha?: string;
  reviewVerdict?: string;
  reviewNotes?: string;
  reworked?: boolean;
  ciFixAttempts?: number;
  ciGreen?: boolean;
  uatDeploymentId?: string;
  uatPreviewUrl?: string;
  uatApproved?: boolean;
  released?: boolean;
  releaseUrl?: string;
  releaseNotes?: string;
  vercelDeploymentId?: string;
  vercelUrl?: string;
}

export interface GateInput {
  answers?: string[];
  approved?: boolean;
  comment?: string;
}

export type GateSpec =
  | { type: "questions"; questions: string[] }
  | { type: "approval"; title: string; description: string; allowChanges?: boolean };

export interface StageContext {
  gh: GithubSession;
  jira: JiraSession | null;
  vercel: VercelSession | null;
  ai: AIConfig;
  requirement: string;
  artifacts: Artifacts;
  input?: GateInput;
}

const FILE_SCHEMA = z.object({ path: z.string(), content: z.string() });

export interface StageResult {
  output: string;
  links: ArtifactLink[];
  artifacts: Artifacts;
  model?: string;
  pending?: boolean;
  gate?: GateSpec;
}

const SHARED_RULES = `You are one specialist agent inside an automated SDLC pipeline that ships real products (GitHub repos, Jira tickets, CI, live deployments).
Be concrete and specific to the product described — never generic filler.`;

// Every file returned must stand alone as the whole file — truncation here is
// what once replaced a full UI with a placeholder.
const FILE_COMPLETENESS_RULE = `Every file you return must be the ENTIRE file, ready to commit as-is: never abbreviate, never elide with comments like "rest unchanged", never return a placeholder or skeleton. If a file would be too long to reproduce in full, OMIT it from the response entirely rather than shortening it — omitting is safe, truncating destroys the file.`;

const APP_CONSTRAINTS = `The product is a fully client-side web app built with Vite and deployed to static hosting:
- index.html — the entire UI: semantic markup plus an inline <style> block (self-contained dark theme, responsive), and it MUST include <script type="module" src="./src/main.ts"></script>
- src/app.ts — the logic core: standalone TypeScript with ZERO imports, exporting typed functions/classes, input validation, and typed error classes
- src/main.ts — the DOM layer: imports from "./app", wires inputs/outputs/events, no other imports
No external packages, no network calls, no frameworks. Data may persist via localStorage.
Entity ids MUST be collision-proof: never derive an id from Date.now() alone (entities created in the same millisecond collide — a real bug this pipeline has shipped). Combine the timestamp with a monotonic counter, or use crypto.randomUUID().
Code comments must describe the code as it is — never leave debugging narration, self-dialogue, or notes about tests/fix attempts in comments.`;

function need<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Pipeline state missing: ${what}. Run the earlier stages first.`);
  }
  return value;
}

function repoRef(ctx: StageContext): RepoRef {
  return parseRepo(need(ctx.artifacts.repo, "repo"));
}

// Guard against automated revisions that gut a file. This is a real shipped
// failure: a rework once replaced the entire 222-line UI with the 12-line
// scaffold placeholder, CI stayed green, and the placeholder went live.
export function revisionProblem(
  path: string,
  revised: string,
  current?: string
): string | null {
  if (path === "index.html" && (revised.includes("🚧") || !revised.includes("src/main.ts"))) {
    return "came back as a stub/placeholder";
  }
  if (current && current.length > 2_000 && revised.length < current.length * 0.35) {
    return `shrank from ${current.length} to ${revised.length} chars (truncated, not a real revision)`;
  }
  return null;
}

export interface RevisionFilter {
  valid: Array<{ path: string; content: string }>;
  skipped: string[];
}

// A truncated file is dropped, not fatal: the model ran out of output budget
// mid-response, so the other files it returned are still good. Keeping the
// current version of the offending file is always safe — losing a revision is
// recoverable, committing a gutted file is what shipped a broken product.
export function filterCompleteRevisions(
  files: Array<{ path: string; content: string }>,
  current: Record<string, string | undefined>
): RevisionFilter {
  const valid: Array<{ path: string; content: string }> = [];
  const skipped: string[] = [];
  for (const f of files) {
    const problem = revisionProblem(f.path, f.content, current[f.path]);
    if (problem) skipped.push(`\`${f.path}\` — ${problem}; kept the existing version`);
    else valid.push(f);
  }
  return { valid, skipped };
}

/* ------------------------------ repo scaffold ------------------------------ */

const SCAFFOLD_PACKAGE = (name: string) => `{
  "name": "${name}",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run --passWithNoTests"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
`;

const SCAFFOLD_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
`;

const SCAFFOLD_VITE = `import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  // Globals on as a safety net so tests using afterEach/vi without importing
  // them still run; the test prompt asks for explicit imports regardless.
  test: { globals: true },
});
`;

const SCAFFOLD_INDEX = (title: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { background: #0a0f1e; color: #e2e8f0; font-family: system-ui, sans-serif;
             display: grid; place-items: center; min-height: 100vh; margin: 0; }
    </style>
  </head>
  <body>
    <p>🚧 This app is being built by the SDLC AI Pipeline…</p>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
`;

const SCAFFOLD_MAIN = `// Placeholder — replaced by the implementation stage.
export {};
`;

const SCAFFOLD_CI = `name: CI

on:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install --no-audit --no-fund
      - run: npx vitest run --passWithNoTests
      - run: npm run build
`;

const SCAFFOLD_DEPLOY = `name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install --no-audit --no-fund
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
`;

const SCAFFOLD_README = (title: string, requirement: string) => `# ${title}

${requirement}

Built and shipped end-to-end by the [SDLC AI Pipeline](https://sdlc-ai-pipeline.vercel.app) — requirements, stories, architecture, implementation, AI code review, tests, CI, and deployment.
`;

/* ---------------------------------- stages --------------------------------- */

async function runPlan(ctx: StageContext): Promise<StageResult> {
  const { data, model } = await aiJson(
    ctx.ai,
    `${SHARED_RULES}\nYou are an experienced project manager running the SDLC planning phase. Be honest — a genuinely infeasible or out-of-scope idea gets a NO-GO.`,
    `Product idea:\n\n"${ctx.requirement}"\n\n${APP_CONSTRAINTS}\n\nRun the planning phase. Return JSON:\n- "verdict": exactly "GO" or "NO-GO". NO-GO if the idea cannot be delivered as a client-side web app under the constraints (needs a backend, real payments, native hardware, external APIs, multi-user realtime), is illegal/harmful, or is too vague to scope.\n- "feasibility": array of exactly 5 objects {"dimension": one of "Technical"|"Economic"|"Operational"|"Legal & Regulatory"|"Schedule", "rating": "high"|"medium"|"low", "assessment": 1-2 sentences specific to this idea}\n- "charter": markdown with ## Objectives (3 bullets), ## Scope (In / Out subsections), ## Success Criteria (3 measurable bullets), ## Assumptions (2-3 bullets)\n- "risks": markdown risk register: 3-4 risks, each with category, likelihood, impact, and mitigation\n- "estimate": markdown: expected pipeline stages ahead and rough timeline for a human team doing the same (for contrast)`,
    z.object({
      verdict: z.enum(["GO", "NO-GO"]),
      feasibility: z.array(
        z.object({ dimension: z.string(), rating: z.string(), assessment: z.string() })
      ),
      charter: z.string(),
      risks: z.string(),
      estimate: z.string(),
    }),
    0.4
  );

  const feasibilityMd = data.feasibility
    .map((f) => `- **${f.dimension}** (${f.rating}): ${f.assessment}`)
    .join("\n");
  const planningDoc = `# Project Plan\n\n## Feasibility Study\n${feasibilityMd}\n\n**Verdict: ${data.verdict}**\n\n${data.charter}\n\n## Risk Register\n${data.risks}\n\n## Estimate\n${data.estimate}`;

  const output =
    data.verdict === "NO-GO"
      ? `## Feasibility Verdict: NO-GO ⛔\n\n${feasibilityMd}\n\n${data.risks}\n\n> The planning phase rejected this idea — a real SDLC stops here rather than building something infeasible. Refine the idea and run again.`
      : `## Feasibility Verdict: GO ✅\n\n${feasibilityMd}\n\n${data.charter}\n\n## Risk Register\n${data.risks}\n\n## Estimate\n${data.estimate}`;

  return {
    output,
    links: [],
    model,
    artifacts: {
      ...ctx.artifacts,
      planVerdict: data.verdict,
      planningDoc: planningDoc.slice(0, 8_000),
    },
  };
}

async function runClarify(ctx: StageContext): Promise<StageResult> {
  const questions = ctx.artifacts.openQuestions ?? [];
  if (questions.length === 0) {
    return {
      output: "## Stakeholder Clarification\n\nThe analyst raised no open questions — proceeding.",
      links: [],
      artifacts: { ...ctx.artifacts, clarifications: "No open questions were raised." },
    };
  }

  if (!ctx.input?.answers) {
    return {
      output:
        "## Stakeholder Clarification\n\nThe business analyst needs your answers before the backlog is written — in a real project, these decisions are the stakeholder's, not the team's.",
      links: [],
      artifacts: ctx.artifacts,
      gate: { type: "questions", questions },
    };
  }

  const qa = questions
    .map((q, i) => `**Q: ${q}**\nA: ${ctx.input!.answers![i]?.trim() || "(stakeholder deferred — use your best judgment)"}`)
    .join("\n\n");
  const { text, model } = await aiText(
    ctx.ai,
    `${SHARED_RULES}\nYou are the business analyst incorporating stakeholder answers. Respond in clean markdown.`,
    `Product: "${ctx.artifacts.featureTitle}"\n\nStakeholder Q&A:\n${qa}\n\nWrite a short "Clarified Decisions" section: for each answer, one bullet stating the concrete decision and its impact on scope, design, or priorities. Under 200 words.`,
    0.4
  );

  const ref = repoRef(ctx);
  const doc = `# Stakeholder Clarifications\n\n${qa}\n\n${text}\n`;
  const commit = await commitFile(
    ctx.gh.token,
    ref,
    need(ctx.artifacts.defaultBranch, "defaultBranch"),
    "docs/CLARIFICATIONS.md",
    doc,
    "docs: stakeholder clarifications"
  );

  return {
    output: `${qa}\n\n${text}`,
    links: [{ label: "CLARIFICATIONS.md", url: commit.html_url }],
    model,
    artifacts: { ...ctx.artifacts, clarifications: `${qa}\n\n${text}`.slice(0, 6_000) },
  };
}

async function runDesignApproval(ctx: StageContext): Promise<StageResult> {
  if (!ctx.input) {
    return {
      output:
        "## Design Review\n\nReview the architecture above. Approve it, or request changes — no code gets written against an unreviewed design.",
      links: [],
      artifacts: ctx.artifacts,
      gate: {
        type: "approval",
        title: "Approve the architecture?",
        description: "Approve to start implementation, or request changes with a comment (one revision cycle).",
        allowChanges: true,
      },
    };
  }

  if (ctx.input.approved) {
    return {
      output: `## Design Approved ✅\n\nApproved by **${ctx.gh.login}**${ctx.input.comment ? ` — "${ctx.input.comment}"` : ""}. Implementation may begin.`,
      links: [],
      artifacts: { ...ctx.artifacts, designApproved: true },
    };
  }

  // Change request: one revision cycle, then proceed with the revision noted.
  const ref = repoRef(ctx);
  const branch = need(ctx.artifacts.branch, "branch");
  const current = await readFileContent(ctx.gh.token, ref, "docs/ARCHITECTURE.md", branch);
  const { text, model } = await aiText(
    ctx.ai,
    `${SHARED_RULES}\nYou are the software architect revising a design after review feedback. Respond with the COMPLETE revised architecture document in clean markdown (no preamble).`,
    `Current architecture document:\n\n${current}\n\nReviewer feedback from ${ctx.gh.login}:\n"${ctx.input.comment ?? "No specifics given — tighten the design."}"\n\n${APP_CONSTRAINTS}\n\nRevise the document to address the feedback.`,
    0.4
  );
  const commit = await commitFile(
    ctx.gh.token,
    ref,
    branch,
    "docs/ARCHITECTURE.md",
    text,
    "docs: revise architecture per design review"
  );

  return {
    output: `## Design Revised per Review 🔁\n\nFeedback: "${ctx.input.comment}"\n\n${text}\n\n> One revision cycle applied — approved to proceed.`,
    links: [{ label: "Revised ARCHITECTURE.md", url: commit.html_url }],
    model,
    artifacts: { ...ctx.artifacts, designApproved: true },
  };
}

async function runReleaseApproval(ctx: StageContext): Promise<StageResult> {
  if (!ctx.input?.approved) {
    return {
      output:
        "## Release Approval\n\nEverything is built, reviewed, and tested. In a real pipeline a human signs off before production — that's you.",
      links: ctx.artifacts.prUrl ? [{ label: `Final PR #${ctx.artifacts.prNumber}`, url: ctx.artifacts.prUrl }] : [],
      artifacts: ctx.artifacts,
      gate: {
        type: "approval",
        title: "Ship v1.0.0 to production?",
        description: "Approving merges the pull request, publishes the release, and deploys the live app.",
      },
    };
  }

  return {
    output: `## Release Approved ✅\n\nSigned off by **${ctx.gh.login}**${ctx.input.comment ? ` — "${ctx.input.comment}"` : ""}. Proceeding to deploy.`,
    links: [],
    artifacts: { ...ctx.artifacts, releaseApproved: true },
  };
}

async function runRequirements(ctx: StageContext): Promise<StageResult> {
  const { data, model } = await aiJson(
    ctx.ai,
    `${SHARED_RULES}\nYou are a senior business analyst writing a Software Requirement Specification (SRS).`,
    `Raw product idea:\n\n"${ctx.requirement}"\n\n${APP_CONSTRAINTS}\n\nReturn JSON with:\n- "title": short product title (max 6 words)\n- "slug": kebab-case repository name (max 4 words, no suffixes)\n- "markdown": an SRS with sections: ## Introduction (purpose and intended users, 2-3 sentences), ## Functional Requirements (numbered FR-1..., 5-8 items with one-line rationale, all achievable in a client-side app — each specific, measurable, and testable), ## Non-Functional Requirements (NFR-1..., 4-5 items, each quantified where possible), ## Constraints (2-3 bullets: technical and platform constraints from the app model), ## Out of Scope (3 bullets), ## Open Questions (3 numbered questions a stakeholder must decide — genuine forks in scope or behavior, not rhetorical)\n- "questions": those same 3 open questions as a plain array of strings`,
    z.object({
      title: z.string(),
      slug: z.string(),
      markdown: z.string(),
      questions: z.array(z.string()),
    }),
    0.5
  );

  const baseSlug = data.slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

  // Each idea gets its own repository; suffix on name collision.
  let repo: Awaited<ReturnType<typeof createRepo>> | null = null;
  let slug = baseSlug;
  for (let i = 0; i < 3 && !repo; i++) {
    try {
      repo = await createRepo(
        ctx.gh.token,
        slug,
        `${data.title} — built by SDLC AI Pipeline`
      );
    } catch (err) {
      if (err instanceof GithubError && err.status === 422) {
        slug = `${baseSlug}-${Math.random().toString(36).slice(2, 5)}`;
      } else {
        throw err;
      }
    }
  }
  if (!repo) throw new Error("Could not create a repository for this idea");
  await new Promise((r) => setTimeout(r, 2_000));

  const ref = parseRepo(repo.full_name);
  await enablePages(ctx.gh.token, ref).catch(() => {});

  const scaffold: Array<[string, string]> = [
    [".gitignore", "node_modules/\ndist/\n*.tsbuildinfo\n"],
    ...(ctx.artifacts.planningDoc
      ? ([["docs/PLANNING.md", `${ctx.artifacts.planningDoc}\n`]] as Array<[string, string]>)
      : []),
    [
      "docs/REQUIREMENTS.md",
      `# Software Requirement Specification — ${data.title}\n\n${data.markdown}\n`,
    ],
    ["package.json", SCAFFOLD_PACKAGE(slug)],
    ["tsconfig.json", SCAFFOLD_TSCONFIG],
    ["vite.config.ts", SCAFFOLD_VITE],
    ["index.html", SCAFFOLD_INDEX(data.title)],
    ["src/main.ts", SCAFFOLD_MAIN],
    [".github/workflows/ci.yml", SCAFFOLD_CI],
    [".github/workflows/deploy.yml", SCAFFOLD_DEPLOY],
    ["README.md", SCAFFOLD_README(data.title, ctx.requirement.trim())],
  ];
  for (const [path, content] of scaffold) {
    await commitFile(ctx.gh.token, ref, repo.default_branch, path, content, `chore: scaffold ${path}`);
  }

  const links: ArtifactLink[] = [{ label: `Repo ${repo.full_name}`, url: repo.html_url }];
  let epic: TicketRef;
  if (ctx.jira) {
    const issue = await createJiraIssue(ctx.jira, "Epic", data.title, data.markdown);
    epic = { title: data.title, url: issue.url, jiraKey: issue.key };
    links.push({ label: `Jira Epic ${issue.key}`, url: issue.url });
  } else {
    const issue = await createIssue(
      ctx.gh.token,
      ref,
      `[Epic] ${data.title}`,
      `${data.markdown}\n\n---\n_Created by SDLC AI Pipeline (no Jira connected — using GitHub Issues)._`,
      []
    );
    epic = { title: data.title, url: issue.html_url, issueNumber: issue.number };
    links.push({ label: `Epic issue #${issue.number}`, url: issue.html_url });
  }

  return {
    output: data.markdown,
    links,
    model,
    artifacts: {
      ...ctx.artifacts,
      openQuestions: data.questions.slice(0, 4),
      slug,
      featureTitle: data.title,
      repo: repo.full_name,
      repoUrl: repo.html_url,
      pagesUrl: `https://${ref.owner}.github.io/${ref.repo}/`,
      defaultBranch: repo.default_branch,
      epic,
    },
  };
}

async function runStories(ctx: StageContext): Promise<StageResult> {
  const epic = need(ctx.artifacts.epic, "epic");
  const { data, model } = await aiJson(
    ctx.ai,
    `${SHARED_RULES}\nYou are a product owner writing sprint-ready user stories.`,
    `Product: "${ctx.artifacts.featureTitle}"\nIdea: "${ctx.requirement}"${
      ctx.artifacts.clarifications
        ? `\n\nStakeholder clarifications (binding decisions):\n${ctx.artifacts.clarifications}`
        : ""
    }\n\nReturn JSON: {"stories": [...]} with 4-6 stories covering the v1 of this client-side app. Each story:\n- "title": imperative, max 10 words\n- "points": 1, 2, 3, 5 or 8\n- "priority": MoSCoW priority — exactly "Must", "Should", or "Could" (v1 needs at least two Must stories)\n- "markdown": "As a <role>, I want <capability> so that <benefit>." followed by an "Acceptance criteria" bullet list (2-3 bullets)`,
    z.object({
      stories: z.array(
        z.object({
          title: z.string(),
          points: z.number(),
          priority: z.string(),
          markdown: z.string(),
        })
      ),
    }),
    0.5
  );

  const ref = repoRef(ctx);
  const links: ArtifactLink[] = [];
  const stories: TicketRef[] = [];
  const lines: string[] = [];

  for (const [i, story] of data.stories.slice(0, 6).entries()) {
    if (ctx.jira) {
      const issue = await createJiraIssue(
        ctx.jira,
        "Story",
        story.title,
        `${story.markdown}\n\nStory points: ${story.points}\nMoSCoW priority: ${story.priority}\nEpic: ${epic.jiraKey}`,
        epic.jiraKey
      );
      stories.push({ title: story.title, url: issue.url, jiraKey: issue.key });
      links.push({ label: issue.key, url: issue.url });
      lines.push(
        `**${issue.key} — ${story.title}** (${story.points} pts · ${story.priority})\n${story.markdown}`
      );
    } else {
      const issue = await createIssue(
        ctx.gh.token,
        ref,
        `[Story] ${story.title}`,
        `${story.markdown}\n\n**Story points:** ${story.points}\n**MoSCoW priority:** ${story.priority}\n**Epic:** #${epic.issueNumber}`,
        []
      );
      stories.push({ title: story.title, url: issue.html_url, issueNumber: issue.number });
      links.push({ label: `#${issue.number}`, url: issue.html_url });
      lines.push(
        `**US-${i + 1} — ${story.title}** (#${issue.number}, ${story.points} pts · ${story.priority})\n${story.markdown}`
      );
    }
  }

  return {
    output: `## User Stories\n\n${lines.join("\n\n")}`,
    links,
    model,
    artifacts: { ...ctx.artifacts, stories },
  };
}

async function runArchitecture(ctx: StageContext): Promise<StageResult> {
  const slug = need(ctx.artifacts.slug, "slug");
  const storyList = (ctx.artifacts.stories ?? []).map((s) => `- ${s.title}`).join("\n");
  const { text, model } = await aiText(
    ctx.ai,
    `${SHARED_RULES}\nYou are a pragmatic software architect. Respond in clean markdown.`,
    `Product: "${ctx.artifacts.featureTitle}"\nIdea: "${ctx.requirement}"\nStories:\n${storyList}${
      ctx.artifacts.clarifications
        ? `\nStakeholder clarifications (binding decisions):\n${ctx.artifacts.clarifications}`
        : ""
    }\n\n${APP_CONSTRAINTS}\n\nProduce a design document with two parts.\n# High-Level Design (HLD): ## System Overview (short paragraph + indented text diagram of index.html → src/main.ts → src/app.ts), ## Component Responsibilities (one line per component), ## Data Design (what lives in memory vs localStorage, with the storage shape).\n# Low-Level Design (LLD): ## Logic Core Specification (src/app.ts: every exported type and function as a code-free list with one-line contracts), ## UI Wireframe (an ASCII wireframe in a code block showing the screen layout — boxes for each control/region, labeled), ## Interaction Flow (numbered user actions → system responses), ## Key Risks (3 risks with mitigations).\nUnder ~600 words total.`,
    0.5
  );

  const ref = repoRef(ctx);
  const baseSha = await getBranchSha(ctx.gh.token, ref, need(ctx.artifacts.defaultBranch, "defaultBranch"));
  const branch = "feature/build";
  try {
    await createBranch(ctx.gh.token, ref, branch, baseSha);
  } catch (err) {
    if (!(err instanceof GithubError && err.status === 422)) throw err;
  }
  const commit = await commitFile(
    ctx.gh.token,
    ref,
    branch,
    "docs/ARCHITECTURE.md",
    `# Architecture — ${ctx.artifacts.featureTitle}\n\n${text}\n`,
    `docs(${slug}): architecture`
  );

  return {
    output: text,
    links: [
      { label: `Branch ${branch}`, url: `${ctx.artifacts.repoUrl}/tree/${branch}` },
      { label: "ARCHITECTURE.md commit", url: commit.html_url },
    ],
    model,
    artifacts: { ...ctx.artifacts, branch },
  };
}

async function runCode(ctx: StageContext): Promise<StageResult> {
  const slug = need(ctx.artifacts.slug, "slug");
  const branch = need(ctx.artifacts.branch, "branch");
  const { data, model } = await aiJson(
    ctx.ai,
    `${SHARED_RULES}\nYou are a senior engineer. Write production-quality, idiomatic TypeScript and clean semantic HTML.`,
    `Build the v1 of "${ctx.artifacts.featureTitle}" — ${ctx.requirement}${
      ctx.artifacts.clarifications
        ? `\n\nStakeholder clarifications (binding decisions):\n${ctx.artifacts.clarifications}`
        : ""
    }\n\n${APP_CONSTRAINTS}\n\nReturn JSON:\n- "note": 2-3 sentence markdown note on what you built\n- "files": exactly four entries with "path" and "content":\n  1. path "src/app.ts" — the logic core (~80-140 lines)\n  2. path "src/main.ts" — the DOM layer (~60-100 lines)\n  3. path "index.html" — the complete UI with inline styles (~80-140 lines), dark theme, responsive, and the module script tag\n  4. path "src/app.test.ts" — the developer's own unit tests: 3-5 happy-path Vitest cases for the core functions (QA writes the deep suite later). CRITICAL: import every vitest API you use from "vitest" (nothing is global), import the module as "./app", use only exports that exist in your src/app.ts, and stub localStorage via a minimal in-memory globalThis.localStorage in beforeEach if the module uses it.\nThe app must be genuinely usable, not a stub.`,
    z.object({ note: z.string(), files: z.array(FILE_SCHEMA) }),
    0.3,
    CODE_OUTPUT_TOKENS
  );

  const ref = repoRef(ctx);
  const allowed = new Set(["src/app.ts", "src/main.ts", "index.html", "src/app.test.ts"]);
  const files = data.files.filter((f) => allowed.has(f.path));
  if (files.length < 3) throw new Error("Implementation did not produce the required files");
  // The first write of each file has no baseline, so only the stub check applies.
  for (const f of files) {
    const problem = revisionProblem(f.path, f.content);
    if (problem) throw new Error(`Implementation produced an unusable ${f.path} — it ${problem}`);
  }

  let lastSha = "";
  for (const f of files) {
    const commit = await commitFile(
      ctx.gh.token,
      ref,
      branch,
      f.path,
      f.content,
      `feat(${slug}): ${f.path}`
    );
    lastSha = commit.sha;
  }

  const closes = (ctx.artifacts.stories ?? [])
    .map((s) => (s.issueNumber ? `Closes #${s.issueNumber}` : s.jiraKey))
    .filter(Boolean)
    .join("\n");
  let pr = await findOpenPullRequest(ctx.gh.token, ref, branch);
  if (!pr) {
    pr = await createPullRequest(
      ctx.gh.token,
      ref,
      branch,
      need(ctx.artifacts.defaultBranch, "defaultBranch"),
      `feat: ${ctx.artifacts.featureTitle}`,
      `${data.note}\n\nEpic: ${ctx.artifacts.epic?.jiraKey ?? `#${ctx.artifacts.epic?.issueNumber}`}\n${closes}\n\n---\n_Opened by SDLC AI Pipeline._`
    );
  }

  const jiraNotes: string[] = [];
  if (ctx.jira) {
    for (const story of ctx.artifacts.stories ?? []) {
      if (story.jiraKey) {
        const ok = await transitionJiraIssue(ctx.jira, story.jiraKey, ["progress", "start"]);
        if (ok) jiraNotes.push(story.jiraKey);
      }
    }
  }

  const appSource = files.find((f) => f.path === "src/app.ts")!.content;
  const output = `${data.note}\n\n\`\`\`typescript\n${appSource}\n\`\`\`${
    jiraNotes.length ? `\n\n_Moved to In Progress: ${jiraNotes.join(", ")}_` : ""
  }`;

  return {
    output,
    links: [
      { label: `PR #${pr.number}`, url: pr.html_url },
      { label: "Branch diff", url: `${ctx.artifacts.repoUrl}/pull/${pr.number}/files` },
    ],
    model,
    artifacts: {
      ...ctx.artifacts,
      moduleSource: appSource,
      prNumber: pr.number,
      prUrl: pr.html_url,
      headSha: lastSha,
    },
  };
}

async function runReview(ctx: StageContext): Promise<StageResult> {
  const prNumber = need(ctx.artifacts.prNumber, "prNumber");
  const ref = repoRef(ctx);
  const files = await getPullRequestFiles(ctx.gh.token, ref, prNumber);
  const diff = files
    .map((f) => `--- ${f.filename} (${f.status}) ---\n${f.patch ?? "(binary or too large)"}`)
    .join("\n\n")
    .slice(0, 16_000);

  const { text, model } = await aiText(
    ctx.ai,
    `${SHARED_RULES}\nYou are a rigorous staff engineer doing code review. Be direct; praise nothing that isn't earned. Respond in clean markdown.`,
    `Review this real pull request diff for "${ctx.artifacts.featureTitle}" (a client-side web app: index.html + src/main.ts + src/app.ts).\n\n${diff}\n\nProduce:\n## Verdict\nOne of exactly: APPROVE, APPROVE WITH COMMENTS, REQUEST CHANGES — plus a one-line justification.\n## Findings\nNumbered, each tagged [bug]/[risk]/[style]/[perf]/[a11y] with severity (high/med/low) and a concrete fix.\n## Test Focus\n3 areas the test stage must cover in src/app.ts.`,
    0.3
  );

  const review = await createPullRequestReview(
    ctx.gh.token,
    ref,
    prNumber,
    `${text}\n\n---\n_AI code review posted by SDLC AI Pipeline._`,
    "COMMENT"
  );

  const verdict = /REQUEST CHANGES/i.test(text)
    ? "REQUEST CHANGES"
    : /APPROVE WITH COMMENTS/i.test(text)
      ? "APPROVE WITH COMMENTS"
      : "APPROVE";

  return {
    output: text,
    links: [{ label: "Posted review", url: review.html_url }],
    model,
    artifacts: { ...ctx.artifacts, reviewVerdict: verdict, reviewNotes: text.slice(0, 6_000) },
  };
}

async function runRework(ctx: StageContext): Promise<StageResult> {
  const slug = need(ctx.artifacts.slug, "slug");
  const branch = need(ctx.artifacts.branch, "branch");
  const prNumber = need(ctx.artifacts.prNumber, "prNumber");
  const reviewNotes = need(ctx.artifacts.reviewNotes, "reviewNotes");
  const ref = repoRef(ctx);

  const [appTs, mainTs, indexHtml, devTests] = await Promise.all([
    readFileContent(ctx.gh.token, ref, "src/app.ts", branch),
    readFileContent(ctx.gh.token, ref, "src/main.ts", branch),
    readFileContent(ctx.gh.token, ref, "index.html", branch),
    readFileContent(ctx.gh.token, ref, "src/app.test.ts", branch).catch(() => ""),
  ]);

  const { data, model } = await aiJson(
    ctx.ai,
    `${SHARED_RULES}\nYou are the senior engineer whose pull request received a REQUEST CHANGES review. Fix every finding properly — no shortcuts.`,
    `The review:\n${reviewNotes}\n\nCurrent files:\n\n--- src/app.ts ---\n${appTs}\n\n--- src/main.ts ---\n${mainTs}\n\n--- index.html ---\n${indexHtml}\n\n--- src/app.test.ts (unit tests; keep them passing) ---\n${devTests}\n\n${APP_CONSTRAINTS}\n\nReturn JSON:\n- "note": 2-3 sentence markdown summary of the rework\n- "addressed": array of one-line strings, one per finding fixed\n- "files": ONLY the files you actually modified (most reviews touch src/app.ts alone — do NOT include a file you did not change), each with "path" (src/app.ts, src/main.ts, index.html, or src/app.test.ts) and the COMPLETE revised "content". ${FILE_COMPLETENESS_RULE} If your changes alter behavior the unit tests cover, include the updated src/app.test.ts.`,
    z.object({ note: z.string(), addressed: z.array(z.string()), files: z.array(FILE_SCHEMA) }),
    0.3,
    CODE_OUTPUT_TOKENS
  );

  const allowed = new Set(["src/app.ts", "src/main.ts", "index.html", "src/app.test.ts"]);
  const returned = data.files.filter((f) => allowed.has(f.path));
  if (returned.length === 0) throw new Error("Rework produced no file changes");
  const { valid: changed, skipped } = filterCompleteRevisions(returned, {
    "src/app.ts": appTs,
    "src/main.ts": mainTs,
    "index.html": indexHtml,
    "src/app.test.ts": devTests,
  });
  if (changed.length === 0) {
    throw new Error(
      `Rework returned only truncated files, so nothing was committed: ${skipped.join("; ")}. Re-run this stage.`
    );
  }

  let lastSha = "";
  let newModuleSource = ctx.artifacts.moduleSource;
  for (const f of changed) {
    const commit = await commitFile(
      ctx.gh.token,
      ref,
      branch,
      f.path,
      f.content,
      `fix(${slug}): address review — ${f.path}`
    );
    lastSha = commit.sha;
    if (f.path === "src/app.ts") newModuleSource = f.content;
  }

  const { text: reReview } = await aiText(
    ctx.ai,
    `${SHARED_RULES}\nYou are the same staff engineer re-reviewing after the author addressed your findings. Respond in clean markdown.`,
    `Your original review:\n${reviewNotes}\n\nThe revised files:\n${changed
      .map((f) => `--- ${f.path} ---\n${f.content}`)
      .join("\n\n")}\n\nProduce:\n## Verdict\nOne of exactly: APPROVE, APPROVE WITH COMMENTS, REQUEST CHANGES — one-line justification focused on whether the findings were resolved.\n## Findings Resolution\nOne line per original finding: resolved or not, and why.`,
    0.3
  );
  const review = await createPullRequestReview(
    ctx.gh.token,
    ref,
    prNumber,
    `${reReview}\n\n---\n_Re-review after rework, posted by SDLC AI Pipeline._`,
    "COMMENT"
  );

  const verdict = /REQUEST CHANGES/i.test(reReview)
    ? "REQUEST CHANGES"
    : /APPROVE WITH COMMENTS/i.test(reReview)
      ? "APPROVE WITH COMMENTS"
      : "APPROVE";

  const output = `${data.note}\n\n## Findings Addressed\n${data.addressed
    .map((a) => `- ${a}`)
    .join("\n")}${
    skipped.length ? `\n\n> Skipped incomplete revisions: ${skipped.join("; ")}.` : ""
  }\n\n## Re-review\n${reReview}${
    verdict === "REQUEST CHANGES"
      ? "\n\n> Re-review still requests changes after one rework iteration — proceeding with the objections on record (single-iteration policy)."
      : ""
  }`;

  return {
    output,
    links: [
      { label: "Fix commits", url: `${ctx.artifacts.repoUrl}/commits/${branch}` },
      { label: "Re-review", url: review.html_url },
    ],
    model,
    artifacts: {
      ...ctx.artifacts,
      moduleSource: newModuleSource,
      headSha: lastSha,
      reviewVerdict: verdict,
      reworked: true,
    },
  };
}

async function runTests(ctx: StageContext): Promise<StageResult> {
  const slug = need(ctx.artifacts.slug, "slug");
  const branch = need(ctx.artifacts.branch, "branch");
  const moduleSource = need(ctx.artifacts.moduleSource, "moduleSource");
  const storyList = (ctx.artifacts.stories ?? [])
    .map((s, i) => `${s.jiraKey ?? `US-${i + 1}`}: ${s.title}`)
    .join("\n");

  const { data, model } = await aiJson(
    ctx.ai,
    `${SHARED_RULES}\nYou are a QA automation engineer. Write Vitest tests that would actually fail on real bugs, plus the formal test documentation a real testing phase produces.`,
    `Module under test — src/app.ts (import it as "./app"):\n\n\`\`\`typescript\n${moduleSource}\n\`\`\`\n\nUser stories being verified:\n${storyList}\n\nReview findings to cover:\n${ctx.artifacts.reviewNotes ?? ""}\n\nReturn JSON:\n- "plan": a concise test plan in markdown: ## Objectives (2 bullets), ## Scope (what is and isn't tested — unit level for the logic core; the build acts as the system-level smoke test), ## Test Types (unit, regression via CI, acceptance via the UAT gate), ## Risk Focus (2-3 highest-risk areas in this module and why)\n- "traceability": a markdown Requirements Traceability Matrix table with columns Story | Test case(s) | Coverage — one row per user story above, naming the exact test case titles that verify it (write "build smoke test" for pure-UI stories the unit suite can't cover)\n- "note": 2 sentence markdown test strategy\n- "source": complete Vitest test file importing from "./app" (this REPLACES the developer's happy-path tests with the full suite). CRITICAL: import EVERY vitest API you use from "vitest" — e.g. import { describe, it, expect, beforeEach, afterEach, vi } from "vitest" — nothing is global. 8-12 focused test cases covering happy path, edge cases, and error handling, with titles matching the traceability matrix. The tests MUST only use exports that actually exist in the module source above. Pure logic tests only — no DOM. If the module uses localStorage, stub it via a minimal in-memory globalThis.localStorage in beforeEach.`,
    z.object({
      plan: z.string(),
      traceability: z.string(),
      note: z.string(),
      source: z.string(),
    }),
    0.3
  );

  const ref = repoRef(ctx);
  const planCommit = await commitFile(
    ctx.gh.token,
    ref,
    branch,
    "docs/TEST_PLAN.md",
    `# Test Plan — ${ctx.artifacts.featureTitle}\n\n${data.plan}\n\n## Requirements Traceability Matrix\n\n${data.traceability}\n`,
    `docs(${slug}): test plan and traceability matrix`
  );
  const commit = await commitFile(
    ctx.gh.token,
    ref,
    branch,
    "src/app.test.ts",
    data.source,
    `test(${slug}): full vitest suite for the logic core`
  );

  return {
    output: `${data.note}\n\n${data.plan}\n\n## Requirements Traceability Matrix\n\n${data.traceability}\n\n\`\`\`typescript\n${data.source}\n\`\`\`\n\n_CI is now running these tests on the PR._`,
    links: [
      { label: "Test plan + RTM", url: planCommit.html_url },
      { label: "Test suite commit", url: commit.html_url },
      { label: "CI runs", url: `${ctx.artifacts.repoUrl}/actions` },
    ],
    model,
    artifacts: { ...ctx.artifacts, headSha: commit.sha },
  };
}

// Testing-phase gate: poll the PR's CI and, when it goes red, diagnose from
// the actual failure logs and push bounded fix commits until green.
async function runCiVerify(ctx: StageContext): Promise<StageResult> {
  const slug = need(ctx.artifacts.slug, "slug");
  const branch = need(ctx.artifacts.branch, "branch");
  const prNumber = need(ctx.artifacts.prNumber, "prNumber");
  const ref = repoRef(ctx);
  const artifacts = { ...ctx.artifacts };

  const prState = await getPullRequest(ctx.gh.token, ref, prNumber);
  const headSha = prState.head.sha;
  artifacts.headSha = headSha;
  const checks = await getCheckRuns(ctx.gh.token, ref, headSha);
  const checkLines = checks.runs
    .map((r) => `- ${r.name}: ${r.status === "completed" ? (r.conclusion ?? "?") : r.status}`)
    .join("\n");
  const attempts = artifacts.ciFixAttempts ?? 0;

  if (checks.total === 0 || checks.completed < checks.total) {
    return {
      output: `## Verifying CI\n\n${checkLines || "- CI has not started yet"}\n\n_Polling until every check on the PR head completes._`,
      links: [{ label: "CI runs", url: `${artifacts.repoUrl}/actions` }],
      artifacts,
      pending: true,
    };
  }

  if (checks.failed === 0) {
    // Test closure: compile the summary report — committed to the default
    // branch so the fresh PR head keeps its green checks.
    const summary = `# Test Summary — ${artifacts.featureTitle}\n\n## Results\n${checkLines}\n\n- Checks passed: ${checks.total}/${checks.total} (100% pass rate)\n- Defect fix cycles during verification: ${attempts}\n- Review verdict: ${artifacts.reviewVerdict ?? "n/a"}${artifacts.reworked ? " (after one rework iteration)" : ""}\n\n## Closure Notes\n${
      attempts > 0
        ? `The build went red during verification; ${attempts} automated fix ${attempts === 1 ? "cycle was" : "cycles were"} applied from the CI failure logs before reaching green.`
        : "All checks passed on the first verification run — no defects surfaced in CI."
    }\nAcceptance testing follows at the UAT gate; regression runs on every future commit via CI.\n\n---\n_Compiled by SDLC AI Pipeline at PR head ${artifacts.headSha}._\n`;
    const summaryCommit = await commitFile(
      ctx.gh.token,
      ref,
      need(artifacts.defaultBranch, "defaultBranch"),
      "docs/TEST_SUMMARY.md",
      summary,
      "docs: test closure summary"
    ).catch(() => null);

    return {
      output: `## CI Green ✅\n\n${checkLines}\n\n${
        attempts > 0
          ? `The build went red and was healed automatically — ${attempts} fix ${attempts === 1 ? "commit" : "commits"} pushed after reading the failure logs.`
          : "All checks passed on the first run — no intervention needed."
      }\n\nTest closure report committed as \`docs/TEST_SUMMARY.md\`.`,
      links: [
        { label: "CI runs", url: `${artifacts.repoUrl}/actions` },
        ...(summaryCommit ? [{ label: "Test summary", url: summaryCommit.html_url }] : []),
      ],
      artifacts: { ...artifacts, ciGreen: true },
    };
  }

  // Red build. Bounded self-heal: two attempts, then a human takes over.
  if (attempts >= 2) {
    throw new Error(
      `CI is still red after ${attempts} automated fix attempts — a human needs to look at the PR. Checks:\n${checkLines}`
    );
  }

  let logTail = "";
  const run = await latestWorkflowRun(ctx.gh.token, ref, "ci.yml", branch);
  if (run) {
    const jobs = await listWorkflowJobs(ctx.gh.token, ref, run.id).catch(() => []);
    const failedJob = jobs.find((j) => j.conclusion === "failure") ?? jobs[0];
    if (failedJob) {
      logTail = await getJobLog(ctx.gh.token, ref, failedJob.id).catch(() => "");
    }
  }

  const [appTs, testTs, mainTs] = await Promise.all([
    readFileContent(ctx.gh.token, ref, "src/app.ts", branch),
    readFileContent(ctx.gh.token, ref, "src/app.test.ts", branch).catch(() => ""),
    readFileContent(ctx.gh.token, ref, "src/main.ts", branch),
  ]);

  const { data, model } = await aiJson(
    ctx.ai,
    `${SHARED_RULES}\nYou are the engineer on call for a red CI build. Diagnose from the log, fix the root cause — the app if the app is wrong, the test if the test is wrong. Never delete or weaken tests to force green.\nThe root cause often hides AWAY from the failing assertion: before rewriting the function the test points at, check systemic causes — id/key generation (Date.now() ids collide within one millisecond), state persistence, and shared fixtures. If an assertion fails on "empty result", trace the INPUT data first.\nOutput clean final code only — no debugging narration, no self-dialogue, no comments about the fix attempt.`,
    `CI failed on the pull request for "${artifacts.featureTitle}".\n\nFailing checks:\n${checkLines}\n\nLog tail from the failed job:\n\`\`\`\n${logTail.slice(-5_000) || "(logs unavailable — reason about the code directly)"}\n\`\`\`\n\nCurrent files:\n\n--- src/app.ts ---\n${appTs}\n\n--- src/app.test.ts ---\n${testTs}\n\n--- src/main.ts ---\n${mainTs}\n\n${APP_CONSTRAINTS}\n\nReturn JSON:\n- "diagnosis": 2-3 sentence markdown root-cause analysis citing the log\n- "files": ONLY the files you changed (src/app.ts, src/app.test.ts, src/main.ts, or index.html), each with "path" and the COMPLETE fixed "content". ${FILE_COMPLETENESS_RULE}`,
    z.object({ diagnosis: z.string(), files: z.array(FILE_SCHEMA) }),
    0.3,
    CODE_OUTPUT_TOKENS
  );

  const allowed = new Set(["src/app.ts", "src/app.test.ts", "src/main.ts", "index.html"]);
  const returned = data.files.filter((f) => allowed.has(f.path));
  if (returned.length === 0) {
    throw new Error(`CI is red and the self-heal produced no fix. Diagnosis: ${data.diagnosis}`);
  }
  const { valid: changed, skipped } = filterCompleteRevisions(returned, {
    "src/app.ts": appTs,
    "src/app.test.ts": testTs,
    "src/main.ts": mainTs,
  });
  if (changed.length === 0) {
    throw new Error(
      `The self-heal returned only truncated files, so nothing was committed: ${skipped.join("; ")}. Re-run this stage.`
    );
  }

  for (const f of changed) {
    const commit = await commitFile(
      ctx.gh.token,
      ref,
      branch,
      f.path,
      f.content,
      `fix(${slug}): heal red CI, attempt ${attempts + 1} — ${f.path}`
    );
    artifacts.headSha = commit.sha;
    if (f.path === "src/app.ts") artifacts.moduleSource = f.content;
  }
  artifacts.ciFixAttempts = attempts + 1;

  return {
    output: `## CI Red — Self-Heal Attempt ${attempts + 1}/2 🔧\n\n**Failing checks:**\n${checkLines}\n\n**Diagnosis:**\n${data.diagnosis}\n\n**Fixed:** ${changed.map((f) => `\`${f.path}\``).join(", ")}${
      skipped.length ? `\n\n> Skipped incomplete revisions: ${skipped.join("; ")}.` : ""
    }\n\n_Fix pushed — waiting for CI to re-run._`,
    links: [
      { label: "Fix commits", url: `${artifacts.repoUrl}/commits/${branch}` },
      { label: "CI runs", url: `${artifacts.repoUrl}/actions` },
    ],
    model,
    artifacts,
    pending: true,
  };
}

// UAT: the stakeholder tries the product before release. With Vercel connected
// a real preview deployment is built from the PR branch; otherwise the PR diff
// stands in. Rejection triggers one fix cycle, mirroring real-world UAT.
async function runUat(ctx: StageContext): Promise<StageResult> {
  const branch = need(ctx.artifacts.branch, "branch");
  const prNumber = need(ctx.artifacts.prNumber, "prNumber");
  const ref = repoRef(ctx);
  const artifacts = { ...ctx.artifacts };

  if (ctx.input?.approved) {
    return {
      output: `## UAT Passed ✅\n\nAccepted by **${ctx.gh.login}**${ctx.input.comment ? ` — "${ctx.input.comment}"` : ""}. The product meets acceptance criteria; on to release.`,
      links: [],
      artifacts: { ...artifacts, uatApproved: true },
    };
  }

  if (ctx.input && !ctx.input.approved) {
    // UAT rejection: one fix cycle against the stakeholder's feedback.
    const slug = need(artifacts.slug, "slug");
    const [appTs, mainTs, indexHtml, suiteTs] = await Promise.all([
      readFileContent(ctx.gh.token, ref, "src/app.ts", branch),
      readFileContent(ctx.gh.token, ref, "src/main.ts", branch),
      readFileContent(ctx.gh.token, ref, "index.html", branch),
      readFileContent(ctx.gh.token, ref, "src/app.test.ts", branch).catch(() => ""),
    ]);
    const { data, model } = await aiJson(
      ctx.ai,
      `${SHARED_RULES}\nYou are the senior engineer fixing a product that failed user acceptance testing. Address the stakeholder's feedback exactly.`,
      `Product: "${artifacts.featureTitle}"\n\nUAT feedback from the stakeholder:\n"${ctx.input.comment ?? "No specifics — polish rough edges."}"\n\nCurrent files:\n\n--- src/app.ts ---\n${appTs}\n\n--- src/main.ts ---\n${mainTs}\n\n--- index.html ---\n${indexHtml}\n\n--- src/app.test.ts (test suite; keep it passing) ---\n${suiteTs}\n\n${APP_CONSTRAINTS}\n\nReturn JSON:\n- "note": 2-3 sentence markdown summary of what you changed to satisfy the feedback\n- "files": ONLY the files you changed, each with "path" (src/app.ts, src/main.ts, index.html, or src/app.test.ts) and the COMPLETE revised "content". ${FILE_COMPLETENESS_RULE} If your changes alter behavior the tests cover, include the updated src/app.test.ts.`,
      z.object({ note: z.string(), files: z.array(FILE_SCHEMA) }),
      0.3,
      CODE_OUTPUT_TOKENS
    );
    const allowed = new Set(["src/app.ts", "src/main.ts", "index.html", "src/app.test.ts"]);
    const returned = data.files.filter((f) => allowed.has(f.path));
    if (returned.length === 0) throw new Error("UAT fix cycle produced no file changes");
    const { valid: changed, skipped } = filterCompleteRevisions(returned, {
      "src/app.ts": appTs,
      "src/main.ts": mainTs,
      "index.html": indexHtml,
      "src/app.test.ts": suiteTs,
    });
    if (changed.length === 0) {
      throw new Error(
        `The UAT fix returned only truncated files, so nothing was committed: ${skipped.join("; ")}. Re-run this stage.`
      );
    }
    for (const f of changed) {
      const commit = await commitFile(
        ctx.gh.token,
        ref,
        branch,
        f.path,
        f.content,
        `fix(${slug}): address UAT feedback — ${f.path}`
      );
      artifacts.headSha = commit.sha;
      if (f.path === "src/app.ts") artifacts.moduleSource = f.content;
    }
    return {
      output: `## UAT Feedback Applied 🔁\n\nFeedback: "${ctx.input.comment}"\n\n${data.note}\n\n**Fixed:** ${changed.map((f) => `\`${f.path}\``).join(", ")}${
        skipped.length ? `\n\n> Skipped incomplete revisions: ${skipped.join("; ")}.` : ""
      }\n\n> One UAT fix cycle applied — accepted to proceed. The release gate re-verifies CI on the new commits.`,
      links: [{ label: "UAT fix commits", url: `${artifacts.repoUrl}/commits/${branch}` }],
      model,
      artifacts: { ...artifacts, uatApproved: true },
    };
  }

  // No input yet — stand up a preview (Vercel path), then present the gate.
  let previewNote = "";
  if (ctx.vercel && !artifacts.uatPreviewUrl) {
    if (!artifacts.uatDeploymentId) {
      try {
        const paths = (await listRepoFiles(ctx.gh.token, ref, branch)).filter(
          (p) => !p.startsWith(".github/") && !p.startsWith("docs/") && p !== "src/app.test.ts"
        );
        const files = [];
        for (const p of paths) {
          files.push({ file: p, data: await readFileContent(ctx.gh.token, ref, p, branch) });
        }
        const dep = await createVercelDeployment(
          ctx.vercel,
          need(artifacts.slug, "slug"),
          files,
          "preview"
        );
        artifacts.uatDeploymentId = dep.id;
      } catch {
        previewNote =
          "\n\n_Preview deployment could not be created — review the PR diff instead._";
      }
    }
    if (artifacts.uatDeploymentId) {
      const dep = await getVercelDeployment(ctx.vercel, artifacts.uatDeploymentId).catch(() => null);
      if (dep && dep.readyState === "READY") {
        artifacts.uatPreviewUrl = `https://${dep.url}`;
      } else if (dep && !["ERROR", "CANCELED"].includes(dep.readyState)) {
        return {
          output: `## Preparing UAT Preview\n\nA preview deployment of the PR branch is building on Vercel (${dep.readyState.toLowerCase()})…`,
          links: artifacts.prUrl ? [{ label: `PR #${prNumber}`, url: artifacts.prUrl }] : [],
          artifacts,
          pending: true,
        };
      } else {
        previewNote = "\n\n_The preview deployment failed — review the PR diff instead._";
      }
    }
  }

  const links: ArtifactLink[] = [];
  if (artifacts.uatPreviewUrl)
    links.push({ label: "🔍 UAT preview", url: artifacts.uatPreviewUrl });
  if (artifacts.prUrl) links.push({ label: `PR #${prNumber}`, url: artifacts.prUrl });

  return {
    output: `## User Acceptance Testing\n\nThe product is built, reviewed, and CI-verified. Before release, acceptance is the stakeholder's call — that's you.\n\n${
      artifacts.uatPreviewUrl
        ? `**Try the live preview:** ${artifacts.uatPreviewUrl}`
        : "No Vercel connection, so there's no pre-merge preview — review the PR to judge acceptance (the app goes live on GitHub Pages right after release)."
    }${previewNote}`,
    links,
    artifacts,
    gate: {
      type: "approval",
      title: "Does the product meet your acceptance criteria?",
      description:
        "Accept to proceed to release, or request changes with specific feedback (one fix cycle).",
      allowChanges: true,
    },
  };
}

async function runRelease(ctx: StageContext): Promise<StageResult> {
  if (!ctx.artifacts.releaseApproved) {
    throw new Error("Release has not been approved — complete the Release Approval gate first");
  }
  const prNumber = need(ctx.artifacts.prNumber, "prNumber");
  const ref = repoRef(ctx);
  let artifacts = { ...ctx.artifacts };

  // Phase 1 — gate on PR CI, then merge + publish the release.
  if (!artifacts.released) {
    // The PR's live head is the source of truth — collaborators (human or
    // otherwise) may have pushed fixes since the pipeline's last commit.
    const prState = await getPullRequest(ctx.gh.token, ref, prNumber);
    const headSha = prState.head.sha;
    artifacts.headSha = headSha;
    const checks = await getCheckRuns(ctx.gh.token, ref, headSha);
    const checkLines = checks.runs
      .map((r) => `- ${r.name}: ${r.status === "completed" ? (r.conclusion ?? "?") : r.status}`)
      .join("\n");

    if (checks.total === 0 || checks.completed < checks.total) {
      return {
        output: `## Waiting for CI\n\n${checkLines || "- CI has not started yet"}\n\n_The release gate polls until every check completes._`,
        links: [{ label: "CI runs", url: `${artifacts.repoUrl}/actions` }],
        artifacts,
        pending: true,
      };
    }
    if (checks.failed > 0) {
      throw new Error(
        `CI failed — release blocked (a real pipeline stops here). Checks:\n${checkLines}`
      );
    }

    if (!artifacts.releaseNotes) {
      const storyLines = (artifacts.stories ?? [])
        .map((s) => `- ${s.jiraKey ?? `#${s.issueNumber}`}: ${s.title}`)
        .join("\n");
      const { text } = await aiText(
        ctx.ai,
        `${SHARED_RULES}\nYou are a release manager. State ONLY facts provided to you — never invent flags, environments, or processes.`,
        `Write release notes for v1.0 of "${artifacts.featureTitle}" (idea: "${ctx.requirement}").\nShipped stories:\n${storyLines}\nFinal review verdict: ${artifacts.reviewVerdict}${artifacts.reworked ? " (after one rework iteration)" : ""}.\nCI: all checks passed.\n\nSections: ## Highlights (user-facing bullets tied to the stories), ## Known Limitations (2-3 honest bullets), ## Quality Gates (one line each: AI review verdict, rework if any, CI result).`,
        0.4
      );
      artifacts.releaseNotes = text.slice(0, 6_000);
    }

    if (!prState.merged) {
      const merge = await mergePullRequest(ctx.gh.token, ref, prNumber);
      if (!merge.merged) throw new Error("GitHub refused the merge — check the PR state");
    }

    try {
      const release = await createRelease(
        ctx.gh.token,
        ref,
        "v1.0.0",
        `${artifacts.featureTitle} v1.0.0`,
        `${artifacts.releaseNotes}\n\n**Live app:** ${artifacts.pagesUrl}\n\n---\n_Released by SDLC AI Pipeline. PR #${prNumber}._`
      );
      artifacts.releaseUrl = release.html_url;
    } catch (err) {
      if (!(err instanceof GithubError && err.status === 422)) throw err;
      artifacts.releaseUrl = `${artifacts.repoUrl}/releases/tag/v1.0.0`;
    }
    artifacts.released = true;

    if (ctx.jira) {
      for (const story of artifacts.stories ?? []) {
        if (story.jiraKey) {
          await transitionJiraIssue(ctx.jira, story.jiraKey, ["done", "complete"]).catch(() => {});
        }
      }
      if (artifacts.epic?.jiraKey) {
        await transitionJiraIssue(ctx.jira, artifacts.epic.jiraKey, ["done", "complete"]).catch(
          () => {}
        );
      }
    } else if (artifacts.epic?.issueNumber) {
      await closeIssue(ctx.gh.token, ref, artifacts.epic.issueNumber).catch(() => {});
    }
  }

  // Phase 2 — wait for the live deployment(s).
  const defaultBranch = need(artifacts.defaultBranch, "defaultBranch");
  const pagesRun = await latestWorkflowRun(ctx.gh.token, ref, "deploy.yml", defaultBranch);
  const pagesDone = pagesRun?.status === "completed";
  const pagesOk = pagesDone && pagesRun?.conclusion === "success";

  if (ctx.vercel && !artifacts.vercelDeploymentId) {
    try {
      const paths = (await listRepoFiles(ctx.gh.token, ref, defaultBranch)).filter(
        (p) => !p.startsWith(".github/") && !p.startsWith("docs/") && p !== "src/app.test.ts"
      );
      const files = [];
      for (const p of paths) {
        files.push({ file: p, data: await readFileContent(ctx.gh.token, ref, p, defaultBranch) });
      }
      const dep = await createVercelDeployment(ctx.vercel, need(artifacts.slug, "slug"), files);
      artifacts.vercelDeploymentId = dep.id;
      artifacts.vercelUrl = `https://${dep.url}`;
    } catch {
      // Vercel is the optional path — Pages remains the deliverable.
    }
  }
  let vercelState = "";
  if (ctx.vercel && artifacts.vercelDeploymentId) {
    try {
      const dep = await getVercelDeployment(ctx.vercel, artifacts.vercelDeploymentId);
      vercelState = dep.readyState;
      if (dep.url) artifacts.vercelUrl = `https://${dep.url}`;
    } catch {
      vercelState = "ERROR";
    }
  }
  const vercelSettled = !ctx.vercel || !artifacts.vercelDeploymentId
    ? true
    : ["READY", "ERROR", "CANCELED"].includes(vercelState);

  if (!pagesDone || !vercelSettled) {
    return {
      output: `## Released — deploying\n\n- GitHub Pages: ${
        pagesDone ? (pagesOk ? "live" : "failed") : (pagesRun?.status ?? "starting…")
      }${ctx.vercel && artifacts.vercelDeploymentId ? `\n- Vercel: ${vercelState || "starting…"}` : ""}\n\n_Waiting for the live deployment to finish._`,
      links: [
        { label: "GitHub Release", url: artifacts.releaseUrl ?? "" },
        { label: "Deploy runs", url: `${artifacts.repoUrl}/actions` },
      ],
      artifacts,
      pending: true,
    };
  }

  // Post-deploy smoke test on the critical path: the live page must serve the
  // real application, not the scaffold placeholder (a failure that shipped once).
  let smokeLine = "";
  if (pagesOk && artifacts.pagesUrl) {
    try {
      const res = await fetch(artifacts.pagesUrl, { signal: AbortSignal.timeout(15_000) });
      const body = await res.text();
      if (!res.ok) {
        smokeLine = `\n\n**Smoke test:** live URL returned HTTP ${res.status} — verify manually.`;
      } else if (body.includes("🚧")) {
        throw new Error(
          "Post-deploy smoke test FAILED: the live page still serves the scaffold placeholder — the application UI was lost upstream. File a corrective maintenance issue to restore it."
        );
      } else {
        smokeLine = "\n\n**Smoke test:** passed — the live page serves the application.";
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("smoke test FAILED")) throw err;
      smokeLine = "\n\n**Smoke test:** could not reach the live URL — verify manually.";
    }
  }

  const links: ArtifactLink[] = [];
  if (pagesOk && artifacts.pagesUrl) links.push({ label: "🌐 Live app", url: artifacts.pagesUrl });
  if (vercelState === "READY" && artifacts.vercelUrl)
    links.push({ label: "▲ Live on Vercel", url: artifacts.vercelUrl });
  links.push({ label: "GitHub Release", url: artifacts.releaseUrl ?? "" });
  links.push({ label: `Merged PR #${prNumber}`, url: artifacts.prUrl ?? "" });

  const deployLine = pagesOk
    ? `**Live at:** ${artifacts.pagesUrl}${smokeLine}`
    : `**GitHub Pages deploy failed** — check the [deploy run](${pagesRun?.html_url ?? `${artifacts.repoUrl}/actions`}).`;

  return {
    output: `${artifacts.releaseNotes ?? ""}\n\n${deployLine}${
      vercelState === "READY" && artifacts.vercelUrl ? `\n**Also live on Vercel:** ${artifacts.vercelUrl}` : ""
    }\n\n**Merged:** PR #${prNumber} (squash). **Tag:** v1.0.0.`,
    links,
    artifacts,
  };
}

/* --------------------------------- dispatch -------------------------------- */

const HANDLERS: Record<StageId, (ctx: StageContext) => Promise<StageResult>> = {
  plan: runPlan,
  requirements: runRequirements,
  clarify: runClarify,
  stories: runStories,
  architecture: runArchitecture,
  design_approval: runDesignApproval,
  code: runCode,
  review: runReview,
  rework: runRework,
  tests: runTests,
  ci_verify: runCiVerify,
  uat: runUat,
  release_approval: runReleaseApproval,
  release: runRelease,
};

export async function runStage(stageId: StageId, ctx: StageContext): Promise<StageResult> {
  const handler = HANDLERS[stageId];
  if (!handler) throw new Error(`Unknown stage: ${stageId}`);
  return handler(ctx);
}
