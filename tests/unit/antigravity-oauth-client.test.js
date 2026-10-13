import { describe, it, expect, vi } from "vitest";

const EXPECTED = {
  clientId: "antigravity-test-client-id",
  clientSecret: "antigravity-test-client-secret",
};
const GOOGLE = {
  clientId: "google-test-client-id",
  clientSecret: "google-test-client-secret",
};

process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = EXPECTED.clientId;
process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = EXPECTED.clientSecret;
process.env.GOOGLE_OAUTH_CLIENT_ID = GOOGLE.clientId;
process.env.GOOGLE_OAUTH_CLIENT_SECRET = GOOGLE.clientSecret;

describe("antigravity oauth client (deduped)", () => {
  it("requires local credentials before generating an authorization URL", async () => {
    const previousId = process.env.ANTIGRAVITY_OAUTH_CLIENT_ID;
    const previousSecret = process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET;
    delete process.env.ANTIGRAVITY_OAUTH_CLIENT_ID;
    delete process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET;

    try {
      const { ANTIGRAVITY_OAUTH_CLIENT } = await import("../../open-sse/providers/shared.js");
      const { generateAuthData } = await import("../../src/lib/oauth/providers/index.js");
      expect(ANTIGRAVITY_OAUTH_CLIENT.clientId).toBe("");
      expect(ANTIGRAVITY_OAUTH_CLIENT.clientSecret).toBe("");
      await expect(generateAuthData("antigravity", "http://127.0.0.1:20228/callback"))
        .rejects.toThrow("ANTIGRAVITY_OAUTH_CLIENT_ID and ANTIGRAVITY_OAUTH_CLIENT_SECRET");
    } finally {
      if (previousId === undefined) delete process.env.ANTIGRAVITY_OAUTH_CLIENT_ID;
      else process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = previousId;
      if (previousSecret === undefined) delete process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET;
      else process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = previousSecret;
    }
  });

  it("uses a late environment override when refreshing tokens", async () => {
    const { refreshTokenByProvider } = await import("../../open-sse/services/tokenRefresh.js");
    const previousId = process.env.ANTIGRAVITY_OAUTH_CLIENT_ID;
    const previousSecret = process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET;
    const previousFetch = global.fetch;
    process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = "override-client-id";
    process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = "override-client-secret";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "new-access", expires_in: 3600 }),
    }));
    global.fetch = fetchMock;

    try {
      const result = await refreshTokenByProvider("antigravity", { refreshToken: "override-refresh-token" });
      const body = fetchMock.mock.calls[0][1].body;
      expect(result.accessToken).toBe("new-access");
      expect(body.get("client_id")).toBe("override-client-id");
      expect(body.get("client_secret")).toBe("override-client-secret");
    } finally {
      global.fetch = previousFetch;
      if (previousId === undefined) delete process.env.ANTIGRAVITY_OAUTH_CLIENT_ID;
      else process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = previousId;
      if (previousSecret === undefined) delete process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET;
      else process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = previousSecret;
    }
  });

  it("generates an authorization URL after local credentials are configured", async () => {
    const { generateAuthData } = await import("../../src/lib/oauth/providers/index.js");
    const authData = await generateAuthData("antigravity", "http://127.0.0.1:20228/callback");
    const url = new URL(authData.authUrl);

    expect(url.searchParams.get("client_id")).toBe(EXPECTED.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:20228/callback");
    expect(url.searchParams.has("client_secret")).toBe(false);
  });

  it("loads canonical credentials from the environment", async () => {
    const { ANTIGRAVITY_OAUTH_CLIENT } = await import("../../open-sse/providers/shared.js");
    expect(ANTIGRAVITY_OAUTH_CLIENT).toEqual(EXPECTED);
  });

  it("registry transport keeps clientId/clientSecret", async () => {
    const ag = (await import("../../open-sse/providers/registry/antigravity.js")).default;
    expect(ag.transport.clientId).toBe(EXPECTED.clientId);
    expect(ag.transport.clientSecret).toBe(EXPECTED.clientSecret);
  });

  it("google client shared by gemini + gemini-cli", async () => {
    const { GOOGLE_OAUTH_CLIENT } = await import("../../open-sse/providers/shared.js");
    expect(GOOGLE_OAUTH_CLIENT).toEqual(GOOGLE);
    const gemini = (await import("../../open-sse/providers/registry/gemini.js")).default;
    const gc = (await import("../../open-sse/providers/registry/gemini-cli.js")).default;
    expect(gemini.transport.clientSecret).toBe(GOOGLE.clientSecret);
    expect(gc.transport.clientSecret).toBe(GOOGLE.clientSecret);
  });

  // Guard: oauth.js must spread shared clients + derive from registry (PROVIDER_OAUTH).
  it("src oauth.js imports shared client + keeps full shape", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../../src/lib/oauth/constants/oauth.js"), "utf8");
    expect(src).toContain('import { ANTIGRAVITY_OAUTH_CLIENT, GOOGLE_OAUTH_CLIENT } from "open-sse/providers/shared.js"');
    expect(src).toContain("...ANTIGRAVITY_OAUTH_CLIENT");
    expect(src).toContain("...GOOGLE_OAUTH_CLIENT");
    // authorizeUrl now lives in registry; oauth.js derives via PROVIDER_OAUTH spread
    expect(src).toContain('PROVIDER_OAUTH["antigravity"]');
    expect(src).toContain('PROVIDER_OAUTH["gemini-cli"]');
    expect(src).not.toContain(EXPECTED.clientSecret); // antigravity secret no longer hardcoded here
    expect(src).not.toContain(GOOGLE.clientSecret);   // gemini secret no longer hardcoded here
  });
});
