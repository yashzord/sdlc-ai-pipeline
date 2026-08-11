import { getGithubSession, setWorkspace } from "@/lib/session";
import { GithubError, commitFile, createRepo, getFileSha, getRepo, parseRepo } from "@/lib/github";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CI_WORKFLOW = `name: CI

on:
  push:
    branches: [main]
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
`;

const PACKAGE_JSON = `{
  "name": "sdlc-workspace",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run --passWithNoTests"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
`;

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
`;

const WORKSPACE_README = `# SDLC AI Workspace

This repository is managed by the SDLC AI Pipeline. Each feature run creates:

- a \`feature/*\` branch with an architecture doc, implementation, and tests
- a pull request with an AI code review
- a CI run (Vitest) gating the merge
- a GitHub Release with generated notes
`;

export async function POST(request: Request) {
  const gh = await getGithubSession();
  if (!gh) return Response.json({ error: "Not signed in with GitHub" }, { status: 401 });

  let body: { repoName?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const repoName = (body.repoName ?? "").trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repoName)) {
    return Response.json({ error: "Invalid repository name" }, { status: 400 });
  }

  const fullName = `${gh.login}/${repoName}`;
  const ref = parseRepo(fullName);

  let repo;
  let created = false;
  try {
    repo = await getRepo(gh.token, ref);
  } catch (err) {
    if (err instanceof GithubError && err.status === 404) {
      repo = await createRepo(gh.token, repoName);
      created = true;
      // GitHub needs a moment before the auto-init commit is addressable.
      await new Promise((r) => setTimeout(r, 2000));
    } else {
      throw err;
    }
  }

  const branch = repo.default_branch;
  const bootstrapped: string[] = [];
  for (const [path, content] of [
    ["package.json", PACKAGE_JSON],
    ["tsconfig.json", TSCONFIG],
    [".github/workflows/ci.yml", CI_WORKFLOW],
    ["README.md", WORKSPACE_README],
  ] as const) {
    try {
      const exists = await getFileSha(gh.token, ref, path, branch);
      if (!exists) {
        await commitFile(gh.token, ref, branch, path, content, `chore: bootstrap ${path}`);
        bootstrapped.push(path);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const hint = path.startsWith(".github/workflows")
        ? " — committing workflow files needs the `workflow` OAuth scope; sign out and sign back in to re-authorize, then click Set up again."
        : "";
      return Response.json(
        { error: `Bootstrap failed at ${path}: ${message}${hint}` },
        { status: 502 }
      );
    }
  }

  await setWorkspace(repo.full_name);
  return Response.json({
    workspace: repo.full_name,
    url: repo.html_url,
    created,
    bootstrapped,
  });
}
