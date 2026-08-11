// Provider-agnostic AI layer built on the Vercel AI SDK.
// The signed-in user's own key (BYOK) takes precedence; the server's
// GEMINI_API_KEY is the shared zero-config default.
import { generateObject, generateText } from "ai";
import { createGoogle } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { z } from "zod";

export type AIProvider = "gemini" | "anthropic" | "groq" | "openrouter";

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model?: string;
}

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  gemini: "Google Gemini",
  anthropic: "Anthropic Claude",
  groq: "Groq",
  openrouter: "OpenRouter",
};

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  gemini: "gemini-2.5-flash",
  anthropic: "claude-sonnet-5",
  groq: "llama-3.3-70b-versatile",
  openrouter: "google/gemini-2.5-flash",
};

export function resolveModelId(cfg: AIConfig): string {
  return cfg.model?.trim() || DEFAULT_MODELS[cfg.provider];
}

function languageModel(cfg: AIConfig) {
  const id = resolveModelId(cfg);
  switch (cfg.provider) {
    case "gemini":
      return createGoogle({ apiKey: cfg.apiKey })(id);
    case "anthropic":
      return createAnthropic({ apiKey: cfg.apiKey })(id);
    case "groq":
      return createGroq({ apiKey: cfg.apiKey })(id);
    case "openrouter":
      return createOpenRouter({ apiKey: cfg.apiKey })(id);
  }
}

// Gemini 2.5 models spend output budget on internal thinking by default,
// which starves long structured responses — turn it off.
function providerOptions(cfg: AIConfig) {
  if (cfg.provider === "gemini" && resolveModelId(cfg).includes("2.5")) {
    return { google: { thinkingConfig: { thinkingBudget: 0 } } };
  }
  return undefined;
}

export function serverDefault(): AIConfig | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return { provider: "gemini", apiKey, model: process.env.GEMINI_MODEL?.trim() || undefined };
}

export function hasServerKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function aiText(
  cfg: AIConfig,
  system: string,
  prompt: string,
  temperature = 0.5
): Promise<{ text: string; model: string }> {
  const { text } = await generateText({
    model: languageModel(cfg),
    system,
    prompt,
    temperature,
    maxOutputTokens: 8192,
    maxRetries: 3,
    providerOptions: providerOptions(cfg),
  });
  if (!text.trim()) throw new Error(`${PROVIDER_LABELS[cfg.provider]} returned an empty response`);
  return { text: text.trim(), model: resolveModelId(cfg) };
}

export async function aiJson<SCHEMA extends z.ZodTypeAny>(
  cfg: AIConfig,
  system: string,
  prompt: string,
  schema: SCHEMA,
  temperature = 0.3
): Promise<{ data: z.infer<SCHEMA>; model: string }> {
  const { object } = await generateObject({
    model: languageModel(cfg),
    system,
    prompt,
    schema,
    temperature,
    maxOutputTokens: 8192,
    maxRetries: 3,
    providerOptions: providerOptions(cfg),
  });
  return { data: object as z.infer<SCHEMA>, model: resolveModelId(cfg) };
}

// Cheap end-to-end key/model check used by the BYOK connect flow.
export async function validateAI(cfg: AIConfig): Promise<void> {
  await generateText({
    model: languageModel(cfg),
    prompt: "Reply with the single word: OK",
    maxOutputTokens: 16,
    maxRetries: 1,
  });
}
