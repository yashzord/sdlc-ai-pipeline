// Thin GitHub REST v3 client operating with the signed-in user's OAuth token.

const API = "https://api.github.com";

export class GithubError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function gh<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = Array.isArray(data.errors)
      ? `: ${data.errors.map((e: { message?: string }) => e.message ?? JSON.stringify(e)).join("; ").slice(0, 200)}`
      : "";
    throw new GithubError(
      `GitHub ${method} ${path} → ${res.status}: ${data.message ?? "unknown error"}${details}`,
      res.status
    );
  }
  return data as T;
}

export interface RepoRef {
  owner: string;
  repo: string;
}

export function parseRepo(fullName: string): RepoRef {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo name: ${fullName}`);
  return { owner, repo };
}

export async function getRepo(token: string, ref: RepoRef) {
  return gh<{ full_name: string; default_branch: string; html_url: string }>(
    token,
    "GET",
    `/repos/${ref.owner}/${ref.repo}`
  );
}

export async function createRepo(token: string, name: string, description: string) {
  return gh<{ full_name: string; default_branch: string; html_url: string; name: string }>(
    token,
    "POST",
    "/user/repos",
    {
      name,
      description,
      private: false,
      auto_init: true,
      has_wiki: false,
      has_projects: false,
    }
  );
}

export async function enablePages(token: string, ref: RepoRef): Promise<void> {
  try {
    await gh(token, "POST", `/repos/${ref.owner}/${ref.repo}/pages`, {
      build_type: "workflow",
    });
  } catch (err) {
    // 409: already enabled — fine.
    if (!(err instanceof GithubError && err.status === 409)) throw err;
  }
}

export async function latestWorkflowRun(
  token: string,
  ref: RepoRef,
  workflowFile: string,
  branch: string
): Promise<{ status: string; conclusion: string | null; html_url: string } | null> {
  try {
    const data = await gh<{
      workflow_runs: Array<{ status: string; conclusion: string | null; html_url: string }>;
    }>(
      token,
      "GET",
      `/repos/${ref.owner}/${ref.repo}/actions/workflows/${workflowFile}/runs?branch=${encodeURIComponent(branch)}&per_page=1`
    );
    return data.workflow_runs[0] ?? null;
  } catch (err) {
    if (err instanceof GithubError && err.status === 404) return null;
    throw err;
  }
}

export async function listRepoFiles(
  token: string,
  ref: RepoRef,
  branch: string
): Promise<string[]> {
  const data = await gh<{ tree: Array<{ path: string; type: string }> }>(
    token,
    "GET",
    `/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  );
  return data.tree.filter((t) => t.type === "blob").map((t) => t.path);
}

export async function readFileContent(
  token: string,
  ref: RepoRef,
  path: string,
  branch: string
): Promise<string> {
  const data = await gh<{ content: string; encoding: string }>(
    token,
    "GET",
    `/repos/${ref.owner}/${ref.repo}/contents/${path}?ref=${encodeURIComponent(branch)}`
  );
  return Buffer.from(data.content, "base64").toString("utf8");
}

export async function getBranchSha(token: string, ref: RepoRef, branch: string) {
  const data = await gh<{ object: { sha: string } }>(
    token,
    "GET",
    `/repos/${ref.owner}/${ref.repo}/git/ref/heads/${encodeURIComponent(branch)}`
  );
  return data.object.sha;
}

export async function createBranch(token: string, ref: RepoRef, branch: string, fromSha: string) {
  return gh(token, "POST", `/repos/${ref.owner}/${ref.repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: fromSha,
  });
}

export async function getFileSha(
  token: string,
  ref: RepoRef,
  path: string,
  branch: string
): Promise<string | null> {
  try {
    const data = await gh<{ sha: string }>(
      token,
      "GET",
      `/repos/${ref.owner}/${ref.repo}/contents/${path}?ref=${encodeURIComponent(branch)}`
    );
    return data.sha;
  } catch (err) {
    if (err instanceof GithubError && err.status === 404) return null;
    throw err;
  }
}

export async function commitFile(
  token: string,
  ref: RepoRef,
  branch: string,
  path: string,
  content: string,
  message: string
) {
  const existingSha = await getFileSha(token, ref, path, branch);
  const data = await gh<{ commit: { sha: string; html_url: string } }>(
    token,
    "PUT",
    `/repos/${ref.owner}/${ref.repo}/contents/${path}`,
    {
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    }
  );
  return data.commit;
}

export async function createIssue(
  token: string,
  ref: RepoRef,
  title: string,
  body: string,
  labels: string[]
) {
  return gh<{ number: number; html_url: string }>(
    token,
    "POST",
    `/repos/${ref.owner}/${ref.repo}/issues`,
    { title, body, labels }
  );
}

export async function closeIssue(token: string, ref: RepoRef, issueNumber: number) {
  return gh(token, "PATCH", `/repos/${ref.owner}/${ref.repo}/issues/${issueNumber}`, {
    state: "closed",
    state_reason: "completed",
  });
}

export async function createPullRequest(
  token: string,
  ref: RepoRef,
  head: string,
  base: string,
  title: string,
  body: string
) {
  return gh<{ number: number; html_url: string; head: { sha: string } }>(
    token,
    "POST",
    `/repos/${ref.owner}/${ref.repo}/pulls`,
    { title, head, base, body }
  );
}

export async function findOpenPullRequest(token: string, ref: RepoRef, headBranch: string) {
  const prs = await gh<Array<{ number: number; html_url: string; head: { sha: string } }>>(
    token,
    "GET",
    `/repos/${ref.owner}/${ref.repo}/pulls?head=${ref.owner}:${encodeURIComponent(headBranch)}&state=open`
  );
  return prs[0] ?? null;
}

export async function getPullRequestFiles(token: string, ref: RepoRef, prNumber: number) {
  return gh<Array<{ filename: string; patch?: string; status: string }>>(
    token,
    "GET",
    `/repos/${ref.owner}/${ref.repo}/pulls/${prNumber}/files?per_page=30`
  );
}

export async function getPullRequest(token: string, ref: RepoRef, prNumber: number) {
  return gh<{
    number: number;
    html_url: string;
    state: string;
    merged: boolean;
    head: { sha: string; ref: string };
  }>(token, "GET", `/repos/${ref.owner}/${ref.repo}/pulls/${prNumber}`);
}

export async function createPullRequestReview(
  token: string,
  ref: RepoRef,
  prNumber: number,
  body: string,
  event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE"
) {
  return gh<{ html_url: string }>(
    token,
    "POST",
    `/repos/${ref.owner}/${ref.repo}/pulls/${prNumber}/reviews`,
    { body, event }
  );
}

export interface CheckRunSummary {
  total: number;
  completed: number;
  failed: number;
  runs: Array<{ name: string; status: string; conclusion: string | null; htmlUrl: string }>;
}

export async function getCheckRuns(
  token: string,
  ref: RepoRef,
  sha: string
): Promise<CheckRunSummary> {
  const data = await gh<{
    total_count: number;
    check_runs: Array<{
      name: string;
      status: string;
      conclusion: string | null;
      html_url: string;
    }>;
  }>(token, "GET", `/repos/${ref.owner}/${ref.repo}/commits/${sha}/check-runs?per_page=20`);
  const runs = data.check_runs.map((r) => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    htmlUrl: r.html_url,
  }));
  return {
    total: data.total_count,
    completed: runs.filter((r) => r.status === "completed").length,
    failed: runs.filter(
      (r) => r.conclusion && !["success", "neutral", "skipped"].includes(r.conclusion)
    ).length,
    runs,
  };
}

export async function mergePullRequest(token: string, ref: RepoRef, prNumber: number) {
  return gh<{ merged: boolean; sha: string }>(
    token,
    "PUT",
    `/repos/${ref.owner}/${ref.repo}/pulls/${prNumber}/merge`,
    { merge_method: "squash" }
  );
}

export async function createRelease(
  token: string,
  ref: RepoRef,
  tag: string,
  name: string,
  body: string
) {
  return gh<{ html_url: string }>(token, "POST", `/repos/${ref.owner}/${ref.repo}/releases`, {
    tag_name: tag,
    name,
    body,
  });
}
