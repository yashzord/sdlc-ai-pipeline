import { describe, expect, it } from "vitest";
import { jiraOAuthConfigured, jiraSiteUrl, markdownToAdf } from "./jira";
import type { JiraSession } from "./session";

describe("markdownToAdf", () => {
  it("converts headings, paragraphs, and lists", () => {
    const adf = markdownToAdf(
      "## Requirements\nSome intro text.\n- first\n- second\n1. step one\n2. step two"
    ) as { type: string; content: Array<{ type: string; content?: unknown[] }> };

    expect(adf.type).toBe("doc");
    const types = adf.content.map((b) => b.type);
    expect(types).toEqual(["heading", "paragraph", "bulletList", "orderedList"]);
    expect((adf.content[2].content as unknown[]).length).toBe(2);
    expect((adf.content[3].content as unknown[]).length).toBe(2);
  });

  it("strips markdown emphasis markers", () => {
    const adf = markdownToAdf("**bold** and `code`") as {
      content: Array<{ content: Array<{ text: string }> }>;
    };
    expect(adf.content[0].content[0].text).toBe("bold and code");
  });

  it("never produces an empty document", () => {
    const adf = markdownToAdf("") as { content: unknown[] };
    expect(adf.content.length).toBeGreaterThan(0);
  });
});

describe("jiraSiteUrl", () => {
  it("uses the site for basic sessions and siteUrl for oauth sessions", () => {
    const basic: JiraSession = {
      kind: "basic",
      site: "https://acme.atlassian.net",
      email: "a@b.c",
      apiToken: "t",
      projectKey: "SDLC",
    };
    const oauth: JiraSession = {
      kind: "oauth",
      cloudId: "cloud-1",
      siteUrl: "https://acme.atlassian.net",
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: Date.now() + 3_600_000,
    };
    expect(jiraSiteUrl(basic)).toBe("https://acme.atlassian.net");
    expect(jiraSiteUrl(oauth)).toBe("https://acme.atlassian.net");
  });
});

describe("jiraOAuthConfigured", () => {
  it("requires both client id and secret", () => {
    const prev = { id: process.env.JIRA_CLIENT_ID, secret: process.env.JIRA_CLIENT_SECRET };
    delete process.env.JIRA_CLIENT_ID;
    delete process.env.JIRA_CLIENT_SECRET;
    expect(jiraOAuthConfigured()).toBe(false);
    process.env.JIRA_CLIENT_ID = "id";
    expect(jiraOAuthConfigured()).toBe(false);
    process.env.JIRA_CLIENT_SECRET = "secret";
    expect(jiraOAuthConfigured()).toBe(true);
    if (prev.id) process.env.JIRA_CLIENT_ID = prev.id;
    if (prev.secret) process.env.JIRA_CLIENT_SECRET = prev.secret;
  });
});
