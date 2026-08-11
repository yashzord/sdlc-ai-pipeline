import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

// OpenRouter PKCE: no client registration needed — just a code challenge
// and a callback URL.
export async function GET(request: Request) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = b64url(new Uint8Array(digest));

  const jar = await cookies();
  jar.set("sdlc_pkce", verifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const origin = new URL(request.url).origin;
  const authorize = new URL("https://openrouter.ai/auth");
  authorize.searchParams.set("callback_url", `${origin}/api/ai/oauth/callback`);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  return Response.redirect(authorize.toString(), 302);
}
