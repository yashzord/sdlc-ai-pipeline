import { z } from "zod";
import type { StageId } from "./stages";
import type { GithubSession, JiraSession, VercelSession } from "./session";
import { aiJson, aiText, type AIConfig } from "./ai";
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
  getPullRequestFiles,
  latestWorkflowRun,
  listRepoFiles,
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
  released?: boolean;
  releaseUrl?: string;
  releaseNotes?: string;
  vercelDeploymentId?: string;
  vercelUrl?: string;
}

export interface StageContext {
  gh: GithubSession;
  jira: JiraSession | null;
  vercel: VercelSession | null;
  ai: AIConfig;
  requirement: string;
  artifacts: Artifacts;
}

const FILE_SCHEMA = z.object({ path: z.string(), content: z.string() });

export interface StageResult {
  output: string;
  links: ArtifactLink[];
  artifacts: Artifacts;
  model?: string;
  pending?: boolean;
}

const SHARED_RULES = `You are one specialist agent inside an automated SDLC pipeline that ships real products (GitHub repos, Jira tickets, CI, live deployments).
Be concrete and specific to the product described — never generic filler.`;

const APP_CONSTRAINTS = `The product is a fully client-side web app built with Vite and deployed to static hosting:
- index.html — the entire UI: semantic markup plus an inline <style> block (self-contained dark theme, responsive), and it MUST include <script type="module" src="./src/main.ts"></script>
- src/app.ts — the logic core: standalone TypeScript with ZERO imports, exporting typed functions/classes, input validation, and typed error classes
- src/main.ts — the DOM layer: imports from "./app", wires inputs/outputs/events, no other imports
No external packages, no network calls, no frameworks. Data may persist via localStorage.`;

function need<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Pipeline state missing: ${what}. Run the earlier stages first.`);
  }
  return value;
}

function repoRef(ctx: StageContext): RepoRef {
  return parseRepo(need(ctx.artifacts.repo, "repo"));
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

const SCAFFOLD_VITE = `import { defineConfig } from "vite";

export default defineConfig({ base: "./" });
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

async function runRequirements(ctx: StageContext): Promise<StageResult> {
  const { data, model } = await aiJson(
    ctx.ai,
    `${SHARED_RULES}\nYou are a senior business analyst.`,
    `Raw product idea:\n\n"${ctx.requirement}"\n\n${APP_CONSTRAINTS}\n\nReturn JSON with:\n- "title": short product title (max 6 words)\n- "slug": kebab-case repository name (max 4 words, no suffixes)\n- "markdown": a requirements document with sections: ## Functional Requirements (numbered FR-1..., 5-8 items with one-line rationale, all achievable in a client-side app), ## Non-Functional Requirements (NFR-1..., 4-5 items), ## Out of Scope (3 bullets), ## Open Questions (3 numbered questions)`,
    z.object({ title: z.string(), slug: z.string(), markdown: z.string() }),
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
    `Product: "${ctx.artifacts.featureTitle}"\nIdea: "${ctx.requirement}"\n\nReturn JSON: {"stories": [...]} with 4-6 stories covering the v1 of this client-side app. Each story:\n- "title": imperative, max 10 words\n- "points": 1, 2, 3, 5 or 8\n- "markdown": "As a <role>, I want <capability> so that <benefit>." followed by an "Acceptance criteria" bullet list (2-3 bullets)`,
    z.object({
      stories: z.array(z.object({ title: z.string(), points: z.number(), markdown: z.string() })),
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
        `${story.markdown}\n\nStory points: ${story.points}\nEpic: ${epic.jiraKey}`,
        epic.jiraKey
      );
      stories.push({ title: story.title, url: issue.url, jiraKey: issue.key });
      links.push({ label: issue.key, url: issue.url });
      lines.push(`**${issue.key} — ${story.title}** (${story.points} pts)\n${story.markdown}`);
    } else {
      const issue = await createIssue(
        ctx.gh.token,
        ref,
        `[Story] ${story.title}`,
        `${story.markdown}\n\n**Story points:** ${story.points}\n**Epic:** #${epic.issueNumber}`,
        []
      );
      stories.push({ title: story.title, url: issue.html_url, issueNumber: issue.number });
      links.push({ label: `#${issue.number}`, url: issue.html_url });
      lines.push(
        `**US-${i + 1} — ${story.title}** (#${issue.number}, ${story.points} pts)\n${story.markdown}`
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
    `Product: "${ctx.artifacts.featureTitle}"\nIdea: "${ctx.requirement}"\nStories:\n${storyList}\n\n${APP_CONSTRAINTS}\n\nProduce an architecture doc with sections: ## System Overview (short paragraph + indented text diagram of index.html → src/main.ts → src/app.ts), ## Logic Core Design (src/app.ts: exported types and functions as a code-free list), ## UI Design (index.html: the main screens/controls and interaction flow), ## State & Persistence (what lives in memory vs localStorage), ## Key Risks (3 risks with mitigations). Under ~450 words.`,
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
    `Build the v1 of "${ctx.artifacts.featureTitle}" — ${ctx.requirement}\n\n${APP_CONSTRAINTS}\n\nReturn JSON:\n- "note": 2-3 sentence markdown note on what you built\n- "files": exactly three entries with "path" and "content":\n  1. path "src/app.ts" — the logic core (~80-140 lines)\n  2. path "src/main.ts" — the DOM layer (~60-100 lines)\n  3. path "index.html" — the complete UI with inline styles (~80-140 lines), dark theme, responsive, and the module script tag\nThe app must be genuinely usable, not a stub.`,
    z.object({ note: z.string(), files: z.array(FILE_SCHEMA) }),
    0.3
  );

  const ref = repoRef(ctx);
  const allowed = new Set(["src/app.ts", "src/main.ts", "index.html"]);
  const files = data.files.filter((f) => allowed.has(f.path));
  if (files.length !== 3) throw new Error("Implementation did not produce the three required files");

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

  const [appTs, mainTs, indexHtml] = await Promise.all([
    readFileContent(ctx.gh.token, ref, "src/app.ts", branch),
    readFileContent(ctx.gh.token, ref, "src/main.ts", branch),
    readFileContent(ctx.gh.token, ref, "index.html", branch),
  ]);

  const { data, model } = await aiJson(
    ctx.ai,
    `${SHARED_RULES}\nYou are the senior engineer whose pull request received a REQUEST CHANGES review. Fix every finding properly — no shortcuts.`,
    `The review:\n${reviewNotes}\n\nCurrent files:\n\n--- src/app.ts ---\n${appTs}\n\n--- src/main.ts ---\n${mainTs}\n\n--- index.html ---\n${indexHtml}\n\n${APP_CONSTRAINTS}\n\nReturn JSON:\n- "note": 2-3 sentence markdown summary of the rework\n- "addressed": array of one-line strings, one per finding fixed\n- "files": ONLY the files you changed, each with "path" (src/app.ts, src/main.ts, or index.html) and the COMPLETE revised "content"`,
    z.object({ note: z.string(), addressed: z.array(z.string()), files: z.array(FILE_SCHEMA) }),
    0.3
  );

  const allowed = new Set(["src/app.ts", "src/main.ts", "index.html"]);
  const changed = data.files.filter((f) => allowed.has(f.path));
  if (changed.length === 0) throw new Error("Rework produced no file changes");

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
    .join("\n")}\n\n## Re-review\n${reReview}${
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

  const { data, model } = await aiJson(
    ctx.ai,
    `${SHARED_RULES}\nYou are a QA automation engineer. Write Vitest tests that would actually fail on real bugs.`,
    `Module under test — src/app.ts (import it as "./app"):\n\n\`\`\`typescript\n${moduleSource}\n\`\`\`\n\nReview findings to cover:\n${ctx.artifacts.reviewNotes ?? ""}\n\nReturn JSON:\n- "note": 2 sentence markdown test strategy\n- "source": complete Vitest test file (import { describe, it, expect } from "vitest"; import from "./app"). 6-10 focused test cases covering happy path, edge cases, and error handling. The tests MUST only use exports that actually exist in the module source above. Pure logic tests only — no DOM.`,
    z.object({ note: z.string(), source: z.string() }),
    0.3
  );

  const ref = repoRef(ctx);
  const commit = await commitFile(
    ctx.gh.token,
    ref,
    branch,
    "src/app.test.ts",
    data.source,
    `test(${slug}): vitest coverage for the logic core`
  );

  return {
    output: `${data.note}\n\n\`\`\`typescript\n${data.source}\n\`\`\`\n\n_CI is now running these tests on the PR._`,
    links: [
      { label: "Test commit", url: commit.html_url },
      { label: "CI runs", url: `${ctx.artifacts.repoUrl}/actions` },
    ],
    model,
    artifacts: { ...ctx.artifacts, headSha: commit.sha },
  };
}

async function runRelease(ctx: StageContext): Promise<StageResult> {
  const prNumber = need(ctx.artifacts.prNumber, "prNumber");
  const ref = repoRef(ctx);
  let artifacts = { ...ctx.artifacts };

  // Phase 1 — gate on PR CI, then merge + publish the release.
  if (!artifacts.released) {
    const headSha = need(artifacts.headSha, "headSha");
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

    const prState = await getPullRequest(ctx.gh.token, ref, prNumber);
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

  const links: ArtifactLink[] = [];
  if (pagesOk && artifacts.pagesUrl) links.push({ label: "🌐 Live app", url: artifacts.pagesUrl });
  if (vercelState === "READY" && artifacts.vercelUrl)
    links.push({ label: "▲ Live on Vercel", url: artifacts.vercelUrl });
  links.push({ label: "GitHub Release", url: artifacts.releaseUrl ?? "" });
  links.push({ label: `Merged PR #${prNumber}`, url: artifacts.prUrl ?? "" });

  const deployLine = pagesOk
    ? `**Live at:** ${artifacts.pagesUrl}`
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
  requirements: runRequirements,
  stories: runStories,
  architecture: runArchitecture,
  code: runCode,
  review: runReview,
  rework: runRework,
  tests: runTests,
  release: runRelease,
};

export async function runStage(stageId: StageId, ctx: StageContext): Promise<StageResult> {
  const handler = HANDLERS[stageId];
  if (!handler) throw new Error(`Unknown stage: ${stageId}`);
  return handler(ctx);
}
