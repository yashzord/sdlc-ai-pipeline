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
    description: "Writes the requirements doc and opens an Epic to track the feature",
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
    description: "Cuts a feature branch and commits the architecture doc to it",
  },
  {
    id: "code",
    title: "Implementation",
    role: "Senior Engineer",
    description: "Commits the implementation and opens a pull request; moves tickets to In Progress",
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
    description: "Commits Vitest tests to the branch — CI runs them for real",
  },
  {
    id: "release",
    title: "Release",
    role: "Release Manager",
    description: "Waits for green CI, merges the PR, publishes a Release; closes the tickets",
  },
];
