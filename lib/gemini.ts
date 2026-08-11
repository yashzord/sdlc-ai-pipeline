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

export async function generateWithGemini(
  system: string,
  prompt: string
): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  let lastError: Error | null = null;
  for (const model of modelCandidates()) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
          }),
          signal: AbortSignal.timeout(60_000),
        }
      );

      if (!res.ok) {
        const body = await res.text();
        // 404 = unknown model → try the next candidate; other statuses too,
        // since quota/permission errors can also be model-specific on free tier.
        lastError = new Error(`Gemini ${model} returned ${res.status}: ${body.slice(0, 300)}`);
        continue;
      }

      const data = await res.json();
      const text: string | undefined = data?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? "")
        .join("");
      if (!text || !text.trim()) {
        lastError = new Error(`Gemini ${model} returned an empty response`);
        continue;
      }
      return { text: text.trim(), model };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error("All Gemini model candidates failed");
}
