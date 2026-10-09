import { describe, it, expect } from "vitest";
import { resolveProviderId, getProviderByAlias, ALIAS_TO_ID } from "@/shared/constants/providers";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { getProvider } from "@/lib/oauth/providers";
import { ANTIGRAVITY_CONFIG } from "@/lib/oauth/constants/oauth";

describe("antigravity / agy provider resolution and logic", () => {
  it("resolves agy and ag alias to antigravity", () => {
    expect(resolveProviderId("agy")).toBe("antigravity");
    expect(resolveProviderId("ag")).toBe("antigravity");
    expect(resolveProviderId("antigravity")).toBe("antigravity");
  });

  it("getProviderByAlias finds antigravity for agy", () => {
    const p = getProviderByAlias("agy");
    expect(p).not.toBeNull();
    expect(p.id).toBe("antigravity");
    expect(p.name).toBe("Antigravity");
  });

  it("ALIAS_TO_ID maps agy to antigravity", () => {
    expect(ALIAS_TO_ID["agy"]).toBe("antigravity");
    expect(ALIAS_TO_ID["ag"]).toBe("antigravity");
  });

  it("normalizeProviderId normalizes agy and ag", () => {
    expect(normalizeProviderId("agy")).toBe("antigravity");
    expect(normalizeProviderId("ag")).toBe("antigravity");
    expect(normalizeProviderId("antigravity")).toBe("antigravity");
  });

  it("oauth getProvider resolves agy and ag to antigravity handler", () => {
    const handlerAgy = getProvider("agy");
    const handlerAg = getProvider("ag");
    const handlerMain = getProvider("antigravity");
    expect(handlerAgy).toBe(handlerMain);
    expect(handlerAg).toBe(handlerMain);
  });

  it("ANTIGRAVITY_CONFIG dynamically exposes clientId and clientSecret", () => {
    expect(typeof ANTIGRAVITY_CONFIG.clientId).toBe("string");
    expect(typeof ANTIGRAVITY_CONFIG.clientSecret).toBe("string");
    if (process.env.ANTIGRAVITY_OAUTH_CLIENT_ID) {
      expect(ANTIGRAVITY_CONFIG.clientId.length).toBeGreaterThan(0);
      expect(ANTIGRAVITY_CONFIG.clientSecret.length).toBeGreaterThan(0);
    }
  });

  it("testSingleConnection succeeds for existing antigravity account if present in DB", async () => {
    if (!process.env.ANTIGRAVITY_OAUTH_CLIENT_ID) return;
    const { testSingleConnection } = await import("@/app/api/providers/[id]/test/testUtils");
    const result = await testSingleConnection("1cded563-8aec-4cd6-bd02-2215e39d3f36");
    if (result.error !== "Connection not found") {
      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    }
  });
});
