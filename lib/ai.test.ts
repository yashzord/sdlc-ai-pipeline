import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS, resolveModelId, serverDefault, hasServerKey } from "./ai";

describe("resolveModelId", () => {
  it("falls back to the provider default when no model is set", () => {
    expect(resolveModelId({ provider: "gemini", apiKey: "k" })).toBe(DEFAULT_MODELS.gemini);
    expect(resolveModelId({ provider: "anthropic", apiKey: "k" })).toBe(DEFAULT_MODELS.anthropic);
    expect(resolveModelId({ provider: "groq", apiKey: "k" })).toBe(DEFAULT_MODELS.groq);
    expect(resolveModelId({ provider: "openrouter", apiKey: "k" })).toBe(
      DEFAULT_MODELS.openrouter
    );
  });

  it("prefers an explicit model and trims whitespace", () => {
    expect(resolveModelId({ provider: "gemini", apiKey: "k", model: " custom-model " })).toBe(
      "custom-model"
    );
    expect(resolveModelId({ provider: "gemini", apiKey: "k", model: "  " })).toBe(
      DEFAULT_MODELS.gemini
    );
  });
});

describe("serverDefault", () => {
  it("returns a gemini config only when the server key exists", () => {
    const prev = { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    expect(serverDefault()).toBeNull();
    expect(hasServerKey()).toBe(false);

    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "gemini-x";
    expect(serverDefault()).toEqual({ provider: "gemini", apiKey: "test-key", model: "gemini-x" });
    expect(hasServerKey()).toBe(true);

    if (prev.key) process.env.GEMINI_API_KEY = prev.key;
    else delete process.env.GEMINI_API_KEY;
    if (prev.model) process.env.GEMINI_MODEL = prev.model;
    else delete process.env.GEMINI_MODEL;
  });
});
