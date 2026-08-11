import { hasLiveKey } from "@/lib/gemini";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    status: "ok",
    mode: hasLiveKey() ? "live" : "demo",
  });
}
