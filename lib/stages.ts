export type StageId =
  | "requirements"
  | "stories"
  | "architecture"
  | "code"
  | "review"
  | "rework"
  | "tests"
  | "release";

export interface StageMeta {
  id: StageId;
  title: string;
  role: string;
  description: string;
}

export const STAGES: StageMeta[] = [
  {
    id: "requirements",
    title: "Requirements Analysis",
    role: "Business Analyst",
    description:
      "Writes the requirements doc, creates the product's own repo, and opens the tracking Epic",
  },
  {
    id: "stories",
    title: "User Stories & Backlog",
    role: "Product Owner",
    description: "Creates real, estimated tickets with acceptance criteria under the epic",
  },
  {
    id: "architecture",
    title: "Architecture & Design",
    role: "Software Architect",
    description: "Cuts the feature branch and commits the architecture doc to it",
  },
  {
    id: "code",
    title: "Implementation",
    role: "Senior Engineer",
    description: "Builds the working app (UI + logic), opens a pull request, moves tickets along",
  },
  {
    id: "review",
    title: "Code Review",
    role: "Staff Engineer",
    description: "Reviews the actual PR diff and posts the review on the pull request",
  },
  {
    id: "rework",
    title: "Rework",
    role: "Senior Engineer",
    description:
      "Runs only on REQUEST CHANGES: fixes the review findings, pushes to the PR, gets re-reviewed",
  },
  {
    id: "tests",
    title: "Test Engineering",
    role: "QA Engineer",
    description: "Commits Vitest tests for the logic core — CI runs them for real",
  },
  {
    id: "release",
    title: "Release & Deploy",
    role: "Release Manager",
    description:
      "Waits for green CI, merges the PR, publishes the release, and waits for the live deployment",
  },
];
