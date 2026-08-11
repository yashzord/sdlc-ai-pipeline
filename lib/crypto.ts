// Seals small JSON payloads (OAuth tokens, Jira credentials) into opaque
// strings for httpOnly cookies using AES-256-GCM. The key derives from
// SESSION_SECRET, so rotating that env var invalidates every session.

function b64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function b64urlDecode(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64url"));
}

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET env var missing or too short (need 16+ chars)");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(payload: unknown): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return `${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(ciphertext))}`;
}

export async function unseal<T>(sealed: string): Promise<T | null> {
  try {
    const [ivPart, dataPart] = sealed.split(".");
    if (!ivPart || !dataPart) return null;
    const key = await getKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64urlDecode(ivPart) as BufferSource },
      key,
      b64urlDecode(dataPart) as BufferSource
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    return null;
  }
}
