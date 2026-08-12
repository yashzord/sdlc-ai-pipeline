import { describe, expect, it } from "vitest";
import { assertCompleteRevision } from "./pipeline";

const REAL_INDEX = `<!doctype html><html><head><title>App</title><style>body{}</style></head><body><main id="app">${"x".repeat(3000)}</main><script type="module" src="./src/main.ts"></script></body></html>`;

describe("assertCompleteRevision", () => {
  it("rejects an index.html that reverted to the scaffold placeholder", () => {
    const placeholder = `<!doctype html><body><p>🚧 This app is being built…</p><script type="module" src="./src/main.ts"></script></body>`;
    expect(() => assertCompleteRevision("index.html", placeholder, REAL_INDEX)).toThrow(
      /stub\/placeholder/
    );
  });

  it("rejects an index.html that lost the module script tag", () => {
    const noScript = `<!doctype html><body><main>${"x".repeat(3000)}</main></body>`;
    expect(() => assertCompleteRevision("index.html", noScript, REAL_INDEX)).toThrow(
      /stub\/placeholder/
    );
  });

  it("rejects a drastic shrink of a substantial file", () => {
    const current = "x".repeat(5_000);
    expect(() => assertCompleteRevision("src/app.ts", "export {};", current)).toThrow(/shrank/);
  });

  it("accepts a genuine revision of similar size", () => {
    expect(() =>
      assertCompleteRevision("index.html", REAL_INDEX.replace("App", "Better App"), REAL_INDEX)
    ).not.toThrow();
  });

  it("accepts small files growing or shrinking modestly without a baseline", () => {
    expect(() => assertCompleteRevision("src/app.ts", "export const a = 1;")).not.toThrow();
  });
});
