import { cookies } from "next/headers";
import { setAISession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  const jar = await cookies();
  const verifier = jar.get("sdlc_pkce")?.value;
  jar.delete("sdlc_pkce");

  if (!code || !verifier) {
    return Response.redirect(`${url.origin}/?ai_error=pkce_missing`, 302);
  }

  const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      code_challenge_method: "S256",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  const key: string | undefined = data.key;
  if (!res.ok || !key) {
    return Response.redirect(`${url.origin}/?ai_error=exchange_failed`, 302);
  }

  await setAISession({ provider: "openrouter", apiKey: key });
  return Response.redirect(`${url.origin}/`, 302);
}
