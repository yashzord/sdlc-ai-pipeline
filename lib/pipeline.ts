import type { StageId } from "./stages";
import type { GithubSession, JiraSession } from "./session";
import { generateJson, generateWithGemini } from "./gemini";
import {
  GithubError,
  closeIssue,
  commitFile,
  createBranch,
  createIssue,
  createPullRequest,
  createPullRequestReview,
  createRelease,
  findOpenPullRequest,
  getBranchSha,
  getCheckRuns,
  getPullRequest,
  getPullRequestFiles,
  getRepo,
  mergePullRequest,
  parseRepo,
  type RepoRef,
} from "./github";
import { createJiraIssue, transitionJiraIssue } from "./jira";

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
  epic?: TicketRef;
  stories?: TicketRef[];
  branch?: string;
  defaultBranch?: string;
  moduleFile?: string;
  moduleSource?: string;
  prNumber?: number;
  prUrl?: string;
  headSha?: string;
  reviewVerdict?: string;
  released?: boolean;
}

export interface StageContext {
  gh: GithubSession;
  jira: JiraSession | null;
  workspace: string;
  requirement: string;
  artifacts: Artifacts;
}

export interface StageResult {
  output: string;
  links: ArtifactLink[];
  artifacts: Artifacts;
  model?: string;
  pending?: boolean;
}

const SHARED_RULES = `You are one specialist agent inside an automated SDLC pipeline that operates on real systems (Jira, GitHub).
Be concrete and specific to the product described — never generic filler.`;

function need<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Pipeline state missing: ${what}. Run the earlier stages first.`);
  }
  return value;
}

function repoRef(ctx: StageContext): RepoRef {
  return parseRepo(ctx.workspace);
}

/* ---------------------------------- stages --------------------------------- */

async function runRequirements(ctx: StageContext): Promise<StageResult> {
  const { data, model } = await generateJson<{
    title: string;
    slug: string;
    markdown: string;
  }>(
    `${SHARED_RULES}\nYou are a senior business analyst.`,
    `Raw product idea:\n\n"${ctx.requirement}"\n\nReturn JSON with:\n- "title": short feature title (max 8 words)\n- "slug": kebab-case slug (max 4 words)\n- "markdown": a requirements document with sections: ## Functional Requirements (numbered FR-1..., 5-8 items with one-line rationale), ## Non-Functional Requirements (NFR-1..., 4-6 items), ## Out of Scope (3 bullets), ## Open Questions (3 numbered questions)`,
    0.5
  );

  const suffix = Math.random().toString(36).slice(2, 5);
  const slug = `${data.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40)}-${suffix}`;
  const links: ArtifactLink[] = [];
  let epic: TicketRef;

  if (ctx.jira) {
    const issue = await createJiraIssue(ctx.jira, "Epic", data.title, data.markdown);
    epic = { title: data.title, url: issue.url, jiraKey: issue.key };
    links.push({ label: `Jira Epic ${issue.key}`, url: issue.url });
  } else {
    const issue = await createIssue(
      ctx.gh.token,
      repoRef(ctx),
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
    artifacts: { ...ctx.artifacts, slug, featureTitle: data.title, epic },
  };
}

async function runStories(ctx: StageContext): Promise<StageResult> {
  const epic = need(ctx.artifacts.epic, "epic");
  const { data, model } = await generateJson<{
    stories: Array<{ title: string; points: number; markdown: string }>;
  }>(
    `${SHARED_RULES}\nYou are a product owner writing sprint-ready user stories.`,
    `Feature: "${ctx.artifacts.featureTitle}"\nProduct idea: "${ctx.requirement}"\n\nReturn JSON: {"stories": [...]} with 4-6 stories. Each story:\n- "title": imperative, max 10 words\n- "points": 1, 2, 3, 5 or 8\n- "markdown": "As a <role>, I want <capability> so that <benefit>." followed by an "Acceptance criteria" bullet list (2-3 bullets)`,
    0.5
  );

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
        repoRef(ctx),
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
  const { text, model } = await generateWithGemini(
    `${SHARED_RULES}\nYou are a pragmatic software architect. Prefer boring, proven technology. Respond in clean markdown.`,
    `Feature: "${ctx.artifacts.featureTitle}"\nProduct idea: "${ctx.requirement}"\nStories:\n${storyList}\n\nProduce an architecture doc with sections: ## System Overview (short paragraph + indented text component diagram), ## Module Design (the single TypeScript module that will implement the core logic in this iteration: its name, public API surface as a code-free list, key types), ## Data Model, ## Key Risks (3 risks with mitigations).\nThe implementation will be a SINGLE standalone TypeScript module with no external dependencies, exercised by Vitest tests — design accordingly. Under ~450 words.`,
    0.5
  );

  const ref = repoRef(ctx);
  const repo = await getRepo(ctx.gh.token, ref);
  const baseSha = await getBranchSha(ctx.gh.token, ref, repo.default_branch);
  const branch = `feature/${slug}`;
  try {
    await createBranch(ctx.gh.token, ref, branch, baseSha);
  } catch (err) {
    // Branch already exists from an earlier attempt of this stage — reuse it.
    if (!(err instanceof GithubError && err.status === 422)) throw err;
  }
  const commit = await commitFile(
    ctx.gh.token,
    ref,
    branch,
    `docs/${slug}/ARCHITECTURE.md`,
    `# Architecture — ${ctx.artifacts.featureTitle}\n\n${text}\n`,
    `docs(${slug}): architecture for ${ctx.artifacts.featureTitle}`
  );

  const branchUrl = `https://github.com/${ctx.workspace}/tree/${branch}`;
  return {
    output: text,
    links: [
      { label: `Branch ${branch}`, url: branchUrl },
      { label: "ARCHITECTURE.md commit", url: commit.html_url },
    ],
    model,
    artifacts: { ...ctx.artifacts, branch, defaultBranch: repo.default_branch },
  };
}

async function runCode(ctx: StageContext): Promise<StageResult> {
  const slug = need(ctx.artifacts.slug, "slug");
  const branch = need(ctx.artifacts.branch, "branch");
  const { data, model } = await generateJson<{
    note: string;
    filename: string;
    source: string;
  }>(
    `${SHARED_RULES}\nYou are a senior engineer. Write production-quality, idiomatic TypeScript.`,
    `Feature: "${ctx.artifacts.featureTitle}"\nProduct idea: "${ctx.requirement}"\n\nImplement the core module designed for this feature. Constraints:\n- Standalone TypeScript, ZERO imports (no external packages, no node builtins)\n- Export the public API (types + functions/class)\n- Include input validation and typed error classes\n- 60-120 lines\n\nReturn JSON:\n- "note": 2-3 sentence markdown note on what you built and why\n- "filename": kebab-case filename ending in .ts\n- "source": the complete file contents`,
    0.3
  );

  const ref = repoRef(ctx);
  const filename = data.filename.replace(/[^a-z0-9.-]/g, "-");
  const path = `src/${slug}/${filename}`;
  const commit = await commitFile(
    ctx.gh.token,
    ref,
    branch,
    path,
    data.source,
    `feat(${slug}): implement ${ctx.artifacts.featureTitle}`
  );

  const closes = (ctx.artifacts.stories ?? [])
    .map((s) => (s.issueNumber ? `Closes #${s.issueNumber}` : s.jiraKey))
    .filter(Boolean)
    .join("\n");
  // A retry of this stage may find the PR already open — reuse it.
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

  const output = `${data.note}\n\n\`\`\`typescript\n${data.source}\n\`\`\`${
    jiraNotes.length ? `\n\n_Moved to In Progress: ${jiraNotes.join(", ")}_` : ""
  }`;

  return {
    output,
    links: [
      { label: `PR #${pr.number}`, url: pr.html_url },
      { label: "Implementation commit", url: commit.html_url },
    ],
    model,
    artifacts: {
      ...ctx.artifacts,
      moduleFile: path,
      moduleSource: data.source,
      prNumber: pr.number,
      prUrl: pr.html_url,
      headSha: commit.sha,
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

  const { text, model } = await generateWithGemini(
    `${SHARED_RULES}\nYou are a rigorous staff engineer doing code review. Be direct; praise nothing that isn't earned. Respond in clean markdown.`,
    `Review this real pull request diff for feature "${ctx.artifacts.featureTitle}".\n\n${diff}\n\nProduce:\n## Verdict\nOne of exactly: APPROVE, APPROVE WITH COMMENTS, REQUEST CHANGES — plus a one-line justification.\n## Findings\nNumbered, each tagged [bug]/[risk]/[style]/[perf] with severity (high/med/low) and a concrete fix.\n## Test Focus\n3 areas the test stage must cover.`,
    0.3
  );

  // Reviewing your own PR: GitHub only allows COMMENT events, so the verdict
  // lives in the review body rather than the review state.
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
    artifacts: { ...ctx.artifacts, reviewVerdict: verdict },
  };
}

async function runTests(ctx: StageContext): Promise<StageResult> {
  const slug = need(ctx.artifacts.slug, "slug");
  const branch = need(ctx.artifacts.branch, "branch");
  const moduleFile = need(ctx.artifacts.moduleFile, "moduleFile");
  const moduleSource = need(ctx.artifacts.moduleSource, "moduleSource");

  const moduleBase = moduleFile.split("/").pop()!.replace(/\.ts$/, "");
  const { data, model } = await generateJson<{ note: string; source: string }>(
    `${SHARED_RULES}\nYou are a QA automation engineer. Write Vitest tests that would actually fail on real bugs.`,
    `Module under test (import it as "./${moduleBase}"):\n\n\`\`\`typescript\n${moduleSource}\n\`\`\`\n\nReview findings to cover:\n${ctx.artifacts.reviewVerdict ?? ""}\n\nReturn JSON:\n- "note": 2 sentence markdown test strategy\n- "source": complete Vitest test file (import { describe, it, expect } from "vitest"; import the module from "./${moduleBase}"). 6-10 focused test cases covering happy path, edge cases, and error handling. The tests MUST only use exports that actually exist in the module source above.`,
    0.3
  );

  const ref = repoRef(ctx);
  const path = `src/${slug}/${moduleBase}.test.ts`;
  const commit = await commitFile(
    ctx.gh.token,
    ref,
    branch,
    path,
    data.source,
    `test(${slug}): vitest coverage for ${moduleBase}`
  );

  return {
    output: `${data.note}\n\n\`\`\`typescript\n${data.source}\n\`\`\`\n\n_CI is now running these tests on the PR._`,
    links: [
      { label: "Test commit", url: commit.html_url },
      { label: "CI runs", url: `https://github.com/${ctx.workspace}/actions` },
    ],
    model,
    artifacts: { ...ctx.artifacts, headSha: commit.sha },
  };
}

async function runRelease(ctx: StageContext): Promise<StageResult> {
  const prNumber = need(ctx.artifacts.prNumber, "prNumber");
  const headSha = need(ctx.artifacts.headSha, "headSha");
  const ref = repoRef(ctx);

  const checks = await getCheckRuns(ctx.gh.token, ref, headSha);
  const checkLines = checks.runs
    .map((r) => `- ${r.name}: ${r.status === "completed" ? (r.conclusion ?? "?") : r.status}`)
    .join("\n");

  if (checks.total === 0 || checks.completed < checks.total) {
    return {
      output: `## Waiting for CI\n\n${checkLines || "- CI has not started yet"}\n\n_The release gate polls until every check completes._`,
      links: [{ label: "CI runs", url: `https://github.com/${ctx.workspace}/actions` }],
      artifacts: ctx.artifacts,
      pending: true,
    };
  }

  if (checks.failed > 0) {
    throw new Error(
      `CI failed — release blocked (a real pipeline stops here). Checks:\n${checkLines}`
    );
  }

  const storyLines = (ctx.artifacts.stories ?? [])
    .map((s) => `- ${s.jiraKey ?? `#${s.issueNumber}`}: ${s.title}`)
    .join("\n");
  const { text, model } = await generateWithGemini(
    `${SHARED_RULES}\nYou are a release manager. Respond in clean markdown.`,
    `Write release notes for shipping feature "${ctx.artifacts.featureTitle}" (idea: "${ctx.requirement}").\nShipped stories:\n${storyLines}\nReview verdict was: ${ctx.artifacts.reviewVerdict}.\n\nSections: ## Highlights (user-facing bullets), ## Known Limitations (2-3 bullets), ## Verification (how this was gated: AI review + CI).`,
    0.5
  );

  // Retry-safe: skip the merge if a previous attempt already merged the PR.
  const prState = await getPullRequest(ctx.gh.token, ref, prNumber);
  if (!prState.merged) {
    const merge = await mergePullRequest(ctx.gh.token, ref, prNumber);
    if (!merge.merged) throw new Error("GitHub refused the merge — check the PR state");
  }

  const tag = `release/${ctx.artifacts.slug}`;
  let release: { html_url: string };
  try {
    release = await createRelease(
      ctx.gh.token,
      ref,
      tag,
      `${ctx.artifacts.featureTitle}`,
      `${text}\n\n---\n_Released by SDLC AI Pipeline. PR #${prNumber}._`
    );
  } catch (err) {
    // Tag already released by a previous attempt — treat as done.
    if (!(err instanceof GithubError && err.status === 422)) throw err;
    release = { html_url: `https://github.com/${ctx.workspace}/releases/tag/${tag}` };
  }

  const jiraNotes: string[] = [];
  if (ctx.jira) {
    for (const story of ctx.artifacts.stories ?? []) {
      if (story.jiraKey) {
        const ok = await transitionJiraIssue(ctx.jira, story.jiraKey, ["done", "complete"]);
        if (ok) jiraNotes.push(story.jiraKey);
      }
    }
    if (ctx.artifacts.epic?.jiraKey) {
      await transitionJiraIssue(ctx.jira, ctx.artifacts.epic.jiraKey, ["done", "complete"]);
    }
  } else if (ctx.artifacts.epic?.issueNumber) {
    // GitHub-issues fallback: stories close via the PR's "Closes #n" links,
    // but the epic issue must be closed explicitly.
    await closeIssue(ctx.gh.token, ref, ctx.artifacts.epic.issueNumber).catch(() => {});
  }

  return {
    output: `${text}\n\n**CI:** all ${checks.total} checks green.\n**Merged:** PR #${prNumber} (squash).${
      jiraNotes.length ? `\n**Jira:** moved to Done: ${jiraNotes.join(", ")}` : ""
    }`,
    links: [
      { label: "GitHub Release", url: release.html_url },
      { label: `Merged PR #${prNumber}`, url: ctx.artifacts.prUrl ?? "" },
    ],
    model,
    artifacts: { ...ctx.artifacts, released: true },
  };
}

/* --------------------------------- dispatch -------------------------------- */

const HANDLERS: Record<StageId, (ctx: StageContext) => Promise<StageResult>> = {
  requirements: runRequirements,
  stories: runStories,
  architecture: runArchitecture,
  code: runCode,
  review: runReview,
  tests: runTests,
  release: runRelease,
};

export async function runStage(stageId: StageId, ctx: StageContext): Promise<StageResult> {
  const handler = HANDLERS[stageId];
  if (!handler) throw new Error(`Unknown stage: ${stageId}`);
  return handler(ctx);
}
