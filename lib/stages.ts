// The pipeline mirrors the canonical 7-phase SDLC exactly:
// Planning → Requirement Analysis → Design → Development → Testing →
// Deployment → Maintenance. Phases group executable steps; some steps are
// human gates where the pipeline pauses for a stakeholder decision.

export type StageId =
  | "plan"
  | "requirements"
  | "clarify"
  | "stories"
  | "architecture"
  | "design_approval"
  | "code"
  | "review"
  | "rework"
  | "tests"
  | "ci_verify"
  | "uat"
  | "release_approval"
  | "release";

export type PhaseName =
  | "Planning"
  | "Requirement Analysis"
  | "Design"
  | "Development"
  | "Testing"
  | "Deployment"
  | "Maintenance";

export const PHASES: PhaseName[] = [
  "Planning",
  "Requirement Analysis",
  "Design",
  "Development",
  "Testing",
  "Deployment",
  "Maintenance",
];

export interface StageMeta {
  id: StageId;
  phase: PhaseName;
  title: string;
  role: string;
  description: string;
}

export const STAGES: StageMeta[] = [
  {
    id: "plan",
    phase: "Planning",
    title: "Project Planning",
    role: "Project Manager",
    description:
      "Feasibility study (technical, economic, operational, legal, schedule) with a go/no-go verdict, project charter, and risk register",
  },
  {
    id: "requirements",
    phase: "Requirement Analysis",
    title: "Requirements Analysis",
    role: "Business Analyst",
    description:
      "Writes the requirements doc, creates the product's repo (committing the planning docs), and opens the tracking Epic",
  },
  {
    id: "clarify",
    phase: "Requirement Analysis",
    title: "Stakeholder Clarification",
    role: "You (Stakeholder)",
    description: "The analyst's open questions come back to you — your answers shape everything downstream",
  },
  {
    id: "stories",
    phase: "Requirement Analysis",
    title: "User Stories & Backlog",
    role: "Product Owner",
    description: "Creates real, estimated tickets with acceptance criteria under the epic",
  },
  {
    id: "architecture",
    phase: "Design",
    title: "Architecture & Design",
    role: "Software Architect",
    description: "Cuts the feature branch and commits the architecture doc to it",
  },
  {
    id: "design_approval",
    phase: "Design",
    title: "Design Review",
    role: "You (Approver)",
    description: "Approve the architecture, or request changes for one revision cycle, before any code is written",
  },
  {
    id: "code",
    phase: "Development",
    title: "Implementation",
    role: "Senior Engineer",
    description: "Builds the working app (UI + logic), opens a pull request, moves tickets along",
  },
  {
    id: "review",
    phase: "Development",
    title: "Code Review",
    role: "Staff Engineer",
    description: "Reviews the actual PR diff and posts the review on the pull request",
  },
  {
    id: "rework",
    phase: "Development",
    title: "Rework",
    role: "Senior Engineer",
    description:
      "Runs only on REQUEST CHANGES: fixes the review findings, pushes to the PR, gets re-reviewed",
  },
  {
    id: "tests",
    phase: "Testing",
    title: "Test Engineering",
    role: "QA Engineer",
    description: "Commits Vitest tests for the logic core — CI runs them for real",
  },
  {
    id: "ci_verify",
    phase: "Testing",
    title: "CI Verification & Self-Heal",
    role: "DevOps Engineer",
    description:
      "Watches the PR's CI run; on a red build it reads the failure logs and pushes fix commits — up to two attempts — until the build is green",
  },
  {
    id: "uat",
    phase: "Testing",
    title: "User Acceptance Testing",
    role: "You (Stakeholder)",
    description:
      "Try the product yourself (a live preview deploy when Vercel is connected) and accept it — or request changes for one fix cycle",
  },
  {
    id: "release_approval",
    phase: "Deployment",
    title: "Release Approval",
    role: "You (Release Manager)",
    description: "The human go/no-go before anything ships to production",
  },
  {
    id: "release",
    phase: "Deployment",
    title: "Release & Deploy",
    role: "Release Manager",
    description:
      "Waits for green CI, merges the PR, publishes the release, and waits for the live deployment",
  },
];
