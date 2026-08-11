export const dynamic = "force-dynamic";

// Vercel integrations start their OAuth flow from the integration's own
// install page; Vercel redirects back to our configured callback with a code.
export async function GET() {
  const slug = process.env.VERCEL_INTEGRATION_SLUG;
  if (!slug || !process.env.VERCEL_CLIENT_ID || !process.env.VERCEL_CLIENT_SECRET) {
    return Response.json(
      { error: "Vercel OAuth is not configured on this deployment" },
      { status: 503 }
    );
  }
  return Response.redirect(`https://vercel.com/integrations/${slug}/new`, 302);
}
