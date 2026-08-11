import { clearSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  await clearSession(["gh", "jira", "vercel", "ai"]);
  return Response.json({ ok: true });
}
