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

export interface VercelSession {
  token: string;
  teamId?: string;
}

export interface AISession {
  provider: "gemini" | "anthropic" | "groq" | "openrouter";
  apiKey: string;
  model?: string;
}

const GH_COOKIE = "sdlc_gh";
const JIRA_COOKIE = "sdlc_jira";
const VERCEL_COOKIE = "sdlc_vercel";
const AI_COOKIE = "sdlc_ai";

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

export async function getVercelSession(): Promise<VercelSession | null> {
  const jar = await cookies();
  const raw = jar.get(VERCEL_COOKIE)?.value;
  return raw ? unseal<VercelSession>(raw) : null;
}

export async function setVercelSession(session: VercelSession): Promise<void> {
  const jar = await cookies();
  jar.set(VERCEL_COOKIE, await seal(session), COOKIE_OPTS);
}

export async function getAISession(): Promise<AISession | null> {
  const jar = await cookies();
  const raw = jar.get(AI_COOKIE)?.value;
  return raw ? unseal<AISession>(raw) : null;
}

export async function setAISession(session: AISession): Promise<void> {
  const jar = await cookies();
  jar.set(AI_COOKIE, await seal(session), COOKIE_OPTS);
}

export async function clearSession(names: ("gh" | "jira" | "vercel" | "ai")[]): Promise<void> {
  const jar = await cookies();
  const map = { gh: GH_COOKIE, jira: JIRA_COOKIE, vercel: VERCEL_COOKIE, ai: AI_COOKIE };
  for (const name of names) jar.delete(map[name]);
}
