import LegalPage from "../legal-layout";

export const metadata = { title: "Privacy Policy — SDLC AI Pipeline" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        SDLC AI Pipeline stores no user data on its servers and has no database. When you connect
        an account (GitHub, an AI provider, Jira, or Vercel), the resulting access token is
        encrypted with AES-256-GCM and stored only in an httpOnly cookie in your own browser. It is
        decrypted transiently, per request, to perform the actions you initiate.
      </p>
      <p>
        Actions the pipeline performs (creating repositories, issues, pull requests, deployments)
        happen in your own accounts, under your own credentials, and are visible and controllable
        there. Your idea text and generated content are sent to the AI provider in effect for your
        session (the app default, or one you connected) solely to generate the pipeline's output.
      </p>
      <p>
        Disconnecting an integration or signing out deletes the corresponding cookies. Revoking the
        app's access in the connected service (GitHub settings, Atlassian, Vercel, or your AI
        provider's dashboard) invalidates its token entirely.
      </p>
      <p>
        Contact: open an issue at{" "}
        <a
          href="https://github.com/yashzord/sdlc-ai-pipeline/issues"
          className="text-indigo-300 hover:underline"
        >
          github.com/yashzord/sdlc-ai-pipeline
        </a>
        .
      </p>
    </LegalPage>
  );
}
