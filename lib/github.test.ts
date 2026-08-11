import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GithubError,
  getCheckRuns,
  findOpenPullRequest,
  parseRepo,
} from "./github";

describe("parseRepo", () => {
  it("splits owner/repo", () => {
    expect(parseRepo("yashzord/sdlc-ai-pipeline")).toEqual({
      owner: "yashzord",
      repo: "sdlc-ai-pipeline",
    });
  });

  it("throws on malformed names", () => {
    expect(() => parseRepo("no-slash")).toThrow(/Invalid repo/);
    expect(() => parseRepo("/leading")).toThrow(/Invalid repo/);
  });
});

describe("GitHub client (mocked fetch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("summarizes check runs including failures", async () => {
    stubFetch(200, {
      total_count: 2,
      check_runs: [
        { name: "test", status: "completed", conclusion: "success", html_url: "u1" },
        { name: "lint", status: "completed", conclusion: "failure", html_url: "u2" },
      ],
    });
    const summary = await getCheckRuns("tok", { owner: "o", repo: "r" }, "sha");
    expect(summary.total).toBe(2);
    expect(summary.completed).toBe(2);
    expect(summary.failed).toBe(1);
  });

  it("treats neutral and skipped conclusions as non-failures", async () => {
    stubFetch(200, {
      total_count: 2,
      check_runs: [
        { name: "a", status: "completed", conclusion: "neutral", html_url: "u" },
        { name: "b", status: "completed", conclusion: "skipped", html_url: "u" },
      ],
    });
    const summary = await getCheckRuns("tok", { owner: "o", repo: "r" }, "sha");
    expect(summary.failed).toBe(0);
  });

  it("returns null when no open PR exists for the branch", async () => {
    stubFetch(200, []);
    expect(await findOpenPullRequest("tok", { owner: "o", repo: "r" }, "feature/x")).toBeNull();
  });

  it("surfaces API error details in GithubError", async () => {
    stubFetch(422, {
      message: "Validation Failed",
      errors: [{ message: "A pull request already exists" }],
    });
    await expect(
      findOpenPullRequest("tok", { owner: "o", repo: "r" }, "feature/x")
    ).rejects.toThrowError(GithubError);
    try {
      await findOpenPullRequest("tok", { owner: "o", repo: "r" }, "feature/x");
    } catch (err) {
      expect((err as GithubError).status).toBe(422);
      expect((err as GithubError).message).toContain("A pull request already exists");
    }
  });
});
