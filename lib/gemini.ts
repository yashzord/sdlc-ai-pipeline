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
  temperature: number
): Promise<GeminiResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: 4096 },
      }),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Gemini ${model} returned ${res.status}: ${body.slice(0, 200)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!text || !text.trim()) throw new Error(`Gemini ${model} returned an empty response`);
  return { text: text.trim(), model };
}

// Tries each candidate model; on rate limits / server errors makes a second
// pass after a short backoff. Bounded by an overall deadline so the route
// stays inside its serverless time budget.
export async function generateWithGemini(
  system: string,
  prompt: string,
  temperature = 0.5
): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  const deadline = Date.now() + 45_000;
  let lastError: Error | null = null;
  for (let pass = 0; pass < 2; pass++) {
    for (const model of modelCandidates()) {
      if (Date.now() > deadline) break;
      try {
        return await attempt(key, model, system, prompt, temperature);
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

// Strict-JSON variant: strips code fences and retries once on parse failure.
export async function generateJson<T>(
  system: string,
  prompt: string,
  temperature = 0.3
): Promise<{ data: T; model: string }> {
  const jsonSystem = `${system}\nRespond with ONLY valid JSON. No markdown fences, no commentary.`;
  let lastError: Error | null = null;
  for (let i = 0; i < 2; i++) {
    const { text, model } = await generateWithGemini(jsonSystem, prompt, temperature);
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    try {
      return { data: JSON.parse(cleaned) as T, model };
    } catch {
      lastError = new Error(`Model returned invalid JSON: ${cleaned.slice(0, 120)}`);
    }
  }
  throw lastError ?? new Error("JSON generation failed");
}
