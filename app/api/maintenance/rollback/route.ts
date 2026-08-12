import { getGithubSession } from "@/lib/session";
import {
  commitFile,
  getRepo,
  listReleases,
  parseRepo,
  readFileContent,
} from "@/lib/github";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Rollback: restore the application files exactly as they were at the
// previous release tag and commit them to the default branch. The deploy
// workflow then ships that state live — the static-hosting equivalent of
// redeploying the last known-good artifact.
const APP_FILES = ["index.html", "src/app.ts", "src/main.ts", "src/app.test.ts"];

export async function POST(request: Request) {
  const gh = await getGithubSession();
  if (!gh) {
    return Response.json({ error: "Not signed in with GitHub" }, { status: 401 });
  }

  let body: { repo?: string };
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

  try {
    const releases = await listReleases(gh.token, ref);
    if (releases.length < 2) {
      return Response.json(
        { error: "Nothing to roll back to — only one release exists" },
        { status: 400 }
      );
    }
    const current = releases[0];
    const previous = releases[1];
    const repoInfo = await getRepo(gh.token, ref);

    let restored = 0;
    let lastCommitUrl = "";
    for (const path of APP_FILES) {
      const content = await readFileContent(gh.token, ref, path, previous.tag_name).catch(
        () => null
      );
      if (content === null) continue;
      const commit = await commitFile(
        gh.token,
        ref,
        repoInfo.default_branch,
        path,
        content,
        `revert: roll back ${path} to ${previous.tag_name}`
      );
      lastCommitUrl = commit.html_url;
      restored++;
    }
    if (restored === 0) {
      return Response.json(
        { error: `Could not read any app files at tag ${previous.tag_name}` },
        { status: 502 }
      );
    }

    return Response.json({
      output: `Rolled back from ${current.tag_name} to ${previous.tag_name} — ${restored} files restored on ${repoInfo.default_branch}. The deploy workflow is shipping the previous version live.`,
      fromTag: current.tag_name,
      toTag: previous.tag_name,
      links: [
        { label: `Restored ${previous.tag_name}`, url: previous.html_url },
        ...(lastCommitUrl ? [{ label: "Rollback commits", url: lastCommitUrl }] : []),
        { label: "Deploy runs", url: `${repoInfo.html_url}/actions` },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message.slice(0, 500) }, { status: 502 });
  }
}
