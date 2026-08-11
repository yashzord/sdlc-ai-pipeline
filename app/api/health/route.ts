import { hasServerKey } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    status: "ok",
    ai: hasServerKey() ? "live" : "byok-only",
    oauth: Boolean(process.env.GITHUB_CLIENT_ID && process.env.SESSION_SECRET)
      ? "configured"
      : "unconfigured",
  });
}
