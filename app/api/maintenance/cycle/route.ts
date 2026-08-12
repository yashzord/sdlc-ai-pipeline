import { z } from "zod";
import { serverDefault, aiJson } from "@/lib/ai";
import { assertCompleteRevision } from "@/lib/pipeline";
import { getAISession, getGithubSession } from "@/lib/session";
import {
  GithubError,
  createBranch,
  commitFile,
  createPullRequest,
  createRelease,
  findOpenPullRequest,
  getBranchSha,
  getCheckRuns,
  getIssue,
  getPullRequest,
  getRepo,
  latestReleaseTag,
  mergePullRequest,
  parseRepo,
  readFileContent,
} from "@/lib/github";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// A maintenance mini-cycle: issue → fix branch → PR → CI → merge → patch
// release. The client polls this route with the returned state until done,
// the same pending/poll pattern the main pipeline uses.

interface CycleState {
  phase: "ci";
  branch: string;
  prNumber: number;
  fixAttempts: number;
  summary: string;
}

interface CycleRequest {
  repo: string;
  issueNumber: number;
  state?: CycleState;
}

const FILE_SCHEMA = z.object({ path: z.string(), content: z.string() });
const ALLOWED_FILES = new Set(["src/app.ts", "src/app.test.ts", "src/main.ts", "index.html"]);

function nextPatchVersion(latestTag: string | null): string {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(latestTag ?? "");
  if (!match) return "v1.0.1";
  return `v${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export async function POST(request: Request) {
  const gh = await getGithubSession();
  if (!gh) {
    return Response.json({ error: "Not signed in with GitHub" }, { status: 401 });
  }
  const ai = (await getAISession()) ?? serverDefault();
  if (!ai) {
    return Response.json(
      { error: "No AI provider available — connect your own key in the setup panel" },
      { status: 503 }
    );
  }

  let body: CycleRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let ref;
  try {
    ref = parseRepo(typeof body.repo === "string" ? body.repo : "");
  } catch {
    return Response.json({ error: "Invalid repo" }, { status: 400 });
  }
  if (ref.owner.toLowerCase() !== gh.login.toLowerCase()) {
    return Response.json({ error: "Repo does not belong to your account" }, { status: 403 });
  }
  if (!Number.isInteger(body.issueNumber) || body.issueNumber < 1) {
    return Response.json({ error: "Invalid issueNumber" }, { status: 400 });
  }

  try {
    const issue = await getIssue(gh.token, ref, body.issueNumber);
    const repoInfo = await getRepo(gh.token, ref);
    const defaultBranch = repoInfo.default_branch;
    const labelNames = issue.labels.map((l) => l.name);
    const kind = labelNames.includes("bug")
      ? "corrective"
      : labelNames.includes("adaptive")
        ? "adaptive"
        : labelNames.includes("preventive")
          ? "preventive"
          : "perfective";
    const kindTitle = kind.charAt(0).toUpperCase() + kind.slice(1);
    const commitPrefix =
      kind === "corrective" ? "fix" : kind === "perfective" ? "feat" : "refactor";
    const engineerBrief = {
      corrective:
        "fix the reported defect at its root cause without breaking existing behavior.",
      adaptive:
        "adapt the app to the changed environment/platform described, preserving all existing behavior.",
      perfective:
        "implement the requested improvement cleanly within the existing architecture.",
      preventive:
        "harden and refactor as described — improve quality, robustness, or maintainability WITHOUT changing observable behavior.",
    }[kind];

    /* ------------------------- phase 1: engineer the fix ------------------------- */
    if (!body.state) {
      const branch = `maintenance/issue-${issue.number}`;

      const [appTs, mainTs, indexHtml] = await Promise.all([
        readFileContent(gh.token, ref, "src/app.ts", defaultBranch),
        readFileContent(gh.token, ref, "src/main.ts", defaultBranch),
        readFileContent(gh.token, ref, "index.html", defaultBranch),
      ]);

      const { data, model } = await aiJson(
        ai,
        `You are a maintenance engineer working on a shipped product. This is ${kind} maintenance: ${engineerBrief} The product is a fully client-side Vite web app (index.html + src/app.ts logic core with zero imports + src/main.ts DOM layer). No external packages, no network calls.`,
        `Issue #${issue.number}: ${issue.title}\n\n${issue.body ?? "(no description)"}\n\nCurrent files:\n\n--- src/app.ts ---\n${appTs}\n\n--- src/main.ts ---\n${mainTs}\n\n--- index.html ---\n${indexHtml}\n\nReturn JSON:\n- "summary": 2-3 sentence markdown summary of the change and why it resolves the issue\n- "files": ONLY the files you changed (src/app.ts, src/main.ts, or index.html), each with "path" and the COMPLETE revised "content". If tests in src/app.test.ts would now fail because behavior legitimately changed, include the updated src/app.test.ts too.`,
        z.object({ summary: z.string(), files: z.array(FILE_SCHEMA) }),
        0.3
      );

      const changed = data.files.filter((f) => ALLOWED_FILES.has(f.path));
      if (changed.length === 0) {
        return Response.json(
          { error: "The maintenance engineer produced no file changes for this issue" },
          { status: 502 }
        );
      }
      const maintCurrent: Record<string, string> = {
        "src/app.ts": appTs,
        "src/main.ts": mainTs,
        "index.html": indexHtml,
      };
      for (const f of changed) assertCompleteRevision(f.path, f.content, maintCurrent[f.path]);

      const baseSha = await getBranchSha(gh.token, ref, defaultBranch);
      try {
        await createBranch(gh.token, ref, branch, baseSha);
      } catch (err) {
        // 422: branch already exists from a previous attempt — reuse it.
        if (!(err instanceof GithubError && err.status === 422)) throw err;
      }

      for (const f of changed) {
        await commitFile(
          gh.token,
          ref,
          branch,
          f.path,
          f.content,
          `${commitPrefix}: ${issue.title.slice(0, 60)} (#${issue.number})`
        );
      }

      let pr = await findOpenPullRequest(gh.token, ref, branch);
      if (!pr) {
        pr = await createPullRequest(
          gh.token,
          ref,
          branch,
          defaultBranch,
          `${commitPrefix}: ${issue.title}`,
          `${kindTitle} maintenance for #${issue.number}.\n\n${data.summary}\n\nCloses #${issue.number}.\n\n---\n_Maintenance cycle run by SDLC AI Pipeline._`
        );
      }

      const state: CycleState = {
        phase: "ci",
        branch,
        prNumber: pr.number,
        fixAttempts: 0,
        summary: data.summary.slice(0, 2_000),
      };
      return Response.json({
        pending: true,
        state,
        model,
        output: `Fix engineered and PR #${pr.number} opened — waiting for CI.`,
        links: [{ label: `Maintenance PR #${pr.number}`, url: pr.html_url }],
      });
    }

    /* --------------------- phase 2: CI gate → merge → release -------------------- */
    const state = body.state;
    const pr = await getPullRequest(gh.token, ref, state.prNumber);

    if (!pr.merged) {
      const checks = await getCheckRuns(gh.token, ref, pr.head.sha);
      const checkLines = checks.runs
        .map((r) => `${r.name}: ${r.status === "completed" ? (r.conclusion ?? "?") : r.status}`)
        .join(", ");

      if (checks.total === 0 || checks.completed < checks.total) {
        return Response.json({
          pending: true,
          state,
          output: `CI running on the maintenance PR (${checkLines || "starting…"})…`,
          links: [{ label: `Maintenance PR #${pr.number}`, url: pr.html_url }],
        });
      }

      if (checks.failed > 0) {
        if (state.fixAttempts >= 1) {
          return Response.json(
            {
              error: `CI is still red on the maintenance PR after an automated fix attempt — inspect PR #${pr.number} manually. Checks: ${checkLines}`,
            },
            { status: 502 }
          );
        }
        // One bounded self-heal attempt on the maintenance branch.
        const [appTs, testTs, mainTs] = await Promise.all([
          readFileContent(gh.token, ref, "src/app.ts", state.branch),
          readFileContent(gh.token, ref, "src/app.test.ts", state.branch).catch(() => ""),
          readFileContent(gh.token, ref, "src/main.ts", state.branch),
        ]);
        const { data } = await aiJson(
          ai,
          `You are the engineer on call for a red CI build on a maintenance PR. Fix the root cause — never delete or weaken tests to force green. The product is a client-side Vite app; src/app.ts must keep zero imports. The root cause often hides away from the failing assertion — check id/key generation (Date.now() ids collide within one millisecond), state persistence, and fixtures before rewriting the asserted function. Output clean final code only — no debugging narration in comments.`,
          `The maintenance change (for issue "${issue.title}") broke CI. Failing checks: ${checkLines}\n\nThe intended change:\n${state.summary}\n\nCurrent files:\n\n--- src/app.ts ---\n${appTs}\n\n--- src/app.test.ts ---\n${testTs}\n\n--- src/main.ts ---\n${mainTs}\n\nReturn JSON:\n- "diagnosis": 1-2 sentence root cause\n- "files": ONLY changed files (src/app.ts, src/app.test.ts, src/main.ts, or index.html) with COMPLETE "content"`,
          z.object({ diagnosis: z.string(), files: z.array(FILE_SCHEMA) }),
          0.3
        );
        const changed = data.files.filter((f) => ALLOWED_FILES.has(f.path));
        if (changed.length === 0) {
          return Response.json(
            { error: `CI red and no fix produced. Diagnosis: ${data.diagnosis}` },
            { status: 502 }
          );
        }
        const healCurrent: Record<string, string> = {
          "src/app.ts": appTs,
          "src/app.test.ts": testTs,
          "src/main.ts": mainTs,
        };
        for (const f of changed) assertCompleteRevision(f.path, f.content, healCurrent[f.path]);
        for (const f of changed) {
          await commitFile(
            gh.token,
            ref,
            state.branch,
            f.path,
            f.content,
            `fix: heal maintenance CI (#${issue.number}) — ${f.path}`
          );
        }
        return Response.json({
          pending: true,
          state: { ...state, fixAttempts: state.fixAttempts + 1 },
          output: `CI went red — pushed a fix (${data.diagnosis}). Waiting for CI to re-run…`,
          links: [{ label: `Maintenance PR #${pr.number}`, url: pr.html_url }],
        });
      }

      const merge = await mergePullRequest(gh.token, ref, state.prNumber);
      if (!merge.merged) {
        return Response.json(
          { error: "GitHub refused the merge — check the maintenance PR state" },
          { status: 502 }
        );
      }
    }

    // Merged (issue auto-closes via "Closes #N") — publish the patch release.
    const tag = nextPatchVersion(await latestReleaseTag(gh.token, ref));
    let releaseUrl = `${repoInfo.html_url}/releases/tag/${tag}`;
    try {
      const release = await createRelease(
        gh.token,
        ref,
        tag,
        `${tag} — ${kind} maintenance`,
        `${kindTitle} maintenance release.\n\n**Resolves:** #${issue.number} — ${issue.title}\n\n${state.summary}\n\n---\n_Maintenance cycle run by SDLC AI Pipeline. PR #${state.prNumber}._`
      );
      releaseUrl = release.html_url;
    } catch (err) {
      // 422: tag already exists from a retried poll — the release stands.
      if (!(err instanceof GithubError && err.status === 422)) throw err;
    }

    return Response.json({
      done: true,
      output: `Merged PR #${state.prNumber}, closed #${issue.number}, and published ${tag}. The deploy workflow is shipping the update to the live app.`,
      links: [
        { label: `Patch release ${tag}`, url: releaseUrl },
        { label: `Merged PR #${state.prNumber}`, url: pr.html_url },
        { label: "Deploy runs", url: `${repoInfo.html_url}/actions` },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message.slice(0, 500) }, { status: 502 });
  }
}
