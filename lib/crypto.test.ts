import { beforeEach, describe, expect, it } from "vitest";
import { seal, unseal } from "./crypto";

describe("seal/unseal", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-secret-at-least-16-chars-long";
  });

  it("round-trips a payload", async () => {
    const payload = { token: "gho_abc123", login: "octocat" };
    const sealed = await seal(payload);
    expect(sealed).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await unseal(sealed)).toEqual(payload);
  });

  it("produces different ciphertexts for the same payload (fresh IV)", async () => {
    const a = await seal({ v: 1 });
    const b = await seal({ v: 1 });
    expect(a).not.toBe(b);
  });

  it("returns null for tampered ciphertext", async () => {
    const sealed = await seal({ v: 1 });
    const [iv, data] = sealed.split(".");
    const flipped = data.slice(0, -2) + (data.endsWith("AA") ? "BB" : "AA");
    expect(await unseal(`${iv}.${flipped}`)).toBeNull();
  });

  it("returns null for malformed input", async () => {
    expect(await unseal("not-a-sealed-value")).toBeNull();
    expect(await unseal("")).toBeNull();
  });

  it("rejects sealing when the secret is missing or weak", async () => {
    process.env.SESSION_SECRET = "short";
    await expect(seal({ v: 1 })).rejects.toThrow(/SESSION_SECRET/);
  });

  it("fails closed when unsealing with a different secret", async () => {
    const sealed = await seal({ v: 1 });
    process.env.SESSION_SECRET = "a-completely-different-secret-key!!";
    expect(await unseal(sealed)).toBeNull();
  });
});
