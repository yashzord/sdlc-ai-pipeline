// Minimal Vercel REST client for the optional per-user Vercel integration.
import type { VercelSession } from "./session";

const API = "https://api.vercel.com";

async function vercel<T>(
  session: VercelSession,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = new URL(`${API}${path}`);
  if (session.teamId) url.searchParams.set("teamId", session.teamId);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${session.token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Vercel ${method} ${path} → ${res.status}: ${data?.error?.message ?? "unknown error"}`
    );
  }
  return data as T;
}

export async function validateVercel(session: VercelSession): Promise<{ username: string }> {
  const data = await vercel<{ user: { username: string } }>(session, "GET", "/v2/user");
  return { username: data.user.username };
}

export async function createVercelDeployment(
  session: VercelSession,
  name: string,
  files: Array<{ file: string; data: string }>,
  target: "production" | "preview" = "production"
): Promise<{ id: string; url: string }> {
  const data = await vercel<{ id: string; url: string }>(session, "POST", "/v13/deployments", {
    name,
    // Omitting target yields a preview deployment.
    ...(target === "production" ? { target: "production" } : {}),
    files,
    projectSettings: { framework: "vite" },
  });
  return { id: data.id, url: data.url };
}

export async function getVercelDeployment(
  session: VercelSession,
  id: string
): Promise<{ readyState: string; url: string }> {
  return vercel<{ readyState: string; url: string }>(session, "GET", `/v13/deployments/${id}`);
}
