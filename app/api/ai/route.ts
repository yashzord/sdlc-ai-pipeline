import { getGithubSession, setAISession, clearSession } from "@/lib/session";
import { validateAI, DEFAULT_MODELS, type AIProvider } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PROVIDERS = new Set<AIProvider>(["gemini", "anthropic", "groq", "openrouter"]);

export async function POST(request: Request) {
  const gh = await getGithubSession();
  if (!gh) return Response.json({ error: "Not signed in with GitHub" }, { status: 401 });

  let body: { provider?: AIProvider; apiKey?: string; model?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const provider = body.provider;
  const apiKey = (body.apiKey ?? "").trim();
  const model = (body.model ?? "").trim() || undefined;
  if (!provider || !PROVIDERS.has(provider)) {
    return Response.json({ error: "Unknown provider" }, { status: 400 });
  }
  if (!apiKey) {
    return Response.json({ error: "An API key is required" }, { status: 400 });
  }

  const cfg = { provider, apiKey, model };
  try {
    await validateAI(cfg);
    await setAISession(cfg);
    return Response.json({
      connected: true,
      provider,
      model: model ?? DEFAULT_MODELS[provider],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Key validation failed: ${message.slice(0, 200)}` },
      { status: 401 }
    );
  }
}

export async function DELETE() {
  await clearSession(["ai"]);
  return Response.json({ ok: true });
}
