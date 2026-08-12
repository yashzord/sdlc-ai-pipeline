import { describe, expect, it } from "vitest";
import { filterCompleteRevisions, revisionProblem } from "./pipeline";

const REAL_INDEX = `<!doctype html><html><head><title>App</title><style>body{}</style></head><body><main id="app">${"x".repeat(3000)}</main><script type="module" src="./src/main.ts"></script></body></html>`;

describe("revisionProblem", () => {
  it("flags an index.html that reverted to the scaffold placeholder", () => {
    const placeholder = `<!doctype html><body><p>🚧 This app is being built…</p><script type="module" src="./src/main.ts"></script></body>`;
    expect(revisionProblem("index.html", placeholder, REAL_INDEX)).toMatch(/stub\/placeholder/);
  });

  it("flags an index.html that lost the module script tag", () => {
    const noScript = `<!doctype html><body><main>${"x".repeat(3000)}</main></body>`;
    expect(revisionProblem("index.html", noScript, REAL_INDEX)).toMatch(/stub\/placeholder/);
  });

  it("flags a drastic shrink of a substantial file", () => {
    expect(revisionProblem("src/app.ts", "export {};", "x".repeat(5_000))).toMatch(/shrank/);
  });

  it("accepts a genuine revision of similar size", () => {
    expect(revisionProblem("index.html", REAL_INDEX.replace("App", "Better App"), REAL_INDEX)).toBeNull();
  });

  it("accepts a small file with no baseline", () => {
    expect(revisionProblem("src/app.ts", "export const a = 1;")).toBeNull();
  });
});

describe("filterCompleteRevisions", () => {
  it("drops only the truncated file and keeps the rest", () => {
    const { valid, skipped } = filterCompleteRevisions(
      [
        { path: "src/app.ts", content: "export const fixed = true;\n".repeat(60) },
        { path: "index.html", content: "<html><body>tiny</body></html>" },
      ],
      { "src/app.ts": "export const old = true;\n".repeat(60), "index.html": REAL_INDEX }
    );
    expect(valid.map((f) => f.path)).toEqual(["src/app.ts"]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain("index.html");
    expect(skipped[0]).toContain("kept the existing version");
  });

  it("keeps every file when all revisions are complete", () => {
    const { valid, skipped } = filterCompleteRevisions(
      [{ path: "index.html", content: REAL_INDEX }],
      { "index.html": REAL_INDEX }
    );
    expect(valid).toHaveLength(1);
    expect(skipped).toEqual([]);
  });

  it("reports every file as skipped when all are truncated", () => {
    const { valid, skipped } = filterCompleteRevisions(
      [{ path: "index.html", content: "<p>🚧 placeholder</p>" }],
      { "index.html": REAL_INDEX }
    );
    expect(valid).toEqual([]);
    expect(skipped).toHaveLength(1);
  });
});
