import { cookies } from "next/headers";
import { seal, unseal } from "./crypto";

export interface GithubSession {
  token: string;
  login: string;
  avatarUrl: string;
}

export interface JiraSession {
  site: string; // https://your-team.atlassian.net
  email: string;
  apiToken: string;
  projectKey: string;
}

const GH_COOKIE = "sdlc_gh";
const JIRA_COOKIE = "sdlc_jira";
const WORKSPACE_COOKIE = "sdlc_workspace";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

export async function getGithubSession(): Promise<GithubSession | null> {
  const jar = await cookies();
  const raw = jar.get(GH_COOKIE)?.value;
  return raw ? unseal<GithubSession>(raw) : null;
}

export async function setGithubSession(session: GithubSession): Promise<void> {
  const jar = await cookies();
  jar.set(GH_COOKIE, await seal(session), COOKIE_OPTS);
}

export async function getJiraSession(): Promise<JiraSession | null> {
  const jar = await cookies();
  const raw = jar.get(JIRA_COOKIE)?.value;
  return raw ? unseal<JiraSession>(raw) : null;
}

export async function setJiraSession(session: JiraSession): Promise<void> {
  const jar = await cookies();
  jar.set(JIRA_COOKIE, await seal(session), COOKIE_OPTS);
}

export async function getWorkspace(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(WORKSPACE_COOKIE)?.value ?? null;
}

export async function setWorkspace(repoFullName: string): Promise<void> {
  const jar = await cookies();
  jar.set(WORKSPACE_COOKIE, repoFullName, { ...COOKIE_OPTS, httpOnly: false });
}

export async function clearSession(names: ("gh" | "jira" | "workspace")[]): Promise<void> {
  const jar = await cookies();
  const map = { gh: GH_COOKIE, jira: JIRA_COOKIE, workspace: WORKSPACE_COOKIE };
  for (const name of names) jar.delete(map[name]);
}
