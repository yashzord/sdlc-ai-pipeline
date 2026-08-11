import { hasLiveKey } from "@/lib/gemini";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    status: "ok",
    ai: hasLiveKey() ? "live" : "unconfigured",
    oauth: Boolean(process.env.GITHUB_CLIENT_ID && process.env.SESSION_SECRET)
      ? "configured"
      : "unconfigured",
  });
}
