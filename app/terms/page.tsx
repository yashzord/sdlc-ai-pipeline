import LegalPage from "../legal-layout";

export const metadata = { title: "Terms of Use — SDLC AI Pipeline" };

export default function Terms() {
  return (
    <LegalPage title="Terms of Use">
      <p>
        SDLC AI Pipeline is a demonstration tool that automates a software delivery lifecycle using
        AI agents acting on accounts you connect. It is provided as-is, without warranty of any
        kind.
      </p>
      <p>
        By using it you authorize the app to act on your behalf in the services you connect —
        creating repositories, issues, branches, pull requests, releases, and deployments — and you
        remain responsible for everything created in your accounts, including reviewing AI-generated
        code before relying on it.
      </p>
      <p>
        AI-generated output may be incorrect or insecure. Quality gates in the pipeline (review,
        tests, CI) reduce but do not eliminate this risk. Usage of connected AI providers is subject
        to those providers' own terms and billing.
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
