const FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];

export function hasLiveKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function modelCandidates(): string[] {
  const configured = process.env.GEMINI_MODEL?.trim();
  const list = configured ? [configured, ...FALLBACK_MODELS] : [...FALLBACK_MODELS];
  return [...new Set(list)];
}

interface GeminiResult {
  text: string;
  model: string;
}

async function attempt(
  key: string,
  model: string,
  system: string,
  prompt: string,
  temperature: number,
  json: boolean
): Promise<GeminiResult> {
  const generationConfig: Record<string, unknown> = {
    temperature,
    maxOutputTokens: 8192,
  };
  if (json) generationConfig.responseMimeType = "application/json";
  // Gemini 2.5 models spend output budget on internal thinking by default,
  // which can truncate long structured responses — turn it off.
  if (model.includes("2.5")) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      }),
      signal: AbortSignal.timeout(40_000),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${model} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const finishReason: string | undefined = data?.candidates?.[0]?.finishReason;
  const text: string | undefined = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!text || !text.trim()) throw new Error(`Gemini ${model} returned an empty response`);
  if (finishReason === "MAX_TOKENS") {
    throw new Error(`Gemini ${model} response was truncated (MAX_TOKENS)`);
  }
  return { text: text.trim(), model };
}

async function generate(
  system: string,
  prompt: string,
  temperature: number,
  json: boolean
): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  const deadline = Date.now() + 50_000;
  let lastError: Error | null = null;
  for (let pass = 0; pass < 2; pass++) {
    for (const model of modelCandidates()) {
      if (Date.now() > deadline) break;
      try {
        return await attempt(key, model, system, prompt, temperature, json);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    if (pass === 0 && Date.now() + 6_000 < deadline) {
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
  throw lastError ?? new Error("All Gemini model candidates failed");
}

export async function generateWithGemini(
  system: string,
  prompt: string,
  temperature = 0.5
): Promise<GeminiResult> {
  return generate(system, prompt, temperature, false);
}

function extractJson(text: string): string {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (cleaned.startsWith("{") || cleaned.startsWith("[")) return cleaned;
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) return cleaned.slice(start, end + 1);
  return cleaned;
}

export async function generateJson<T>(
  system: string,
  prompt: string,
  temperature = 0.3
): Promise<{ data: T; model: string }> {
  const jsonSystem = `${system}\nRespond with ONLY a single valid JSON object matching the requested shape. No commentary.`;
  let lastError: Error | null = null;
  for (let i = 0; i < 2; i++) {
    const { text, model } = await generate(jsonSystem, prompt, temperature, true);
    try {
      return { data: JSON.parse(extractJson(text)) as T, model };
    } catch {
      lastError = new Error(`Model returned invalid JSON: ${text.slice(0, 120)}`);
    }
  }
  throw lastError ?? new Error("JSON generation failed");
}
