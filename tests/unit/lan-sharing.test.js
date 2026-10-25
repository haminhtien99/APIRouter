import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
    headers: init?.headers,
  })),
  cookies: vi.fn(),
  getSettings: vi.fn(),
  getEffectiveLanAccessKey: vi.fn(),
  setLanAuthCookie: vi.fn(),
  verifyLanAuthToken: vi.fn(),
  checkLock: vi.fn(),
  recordFail: vi.fn(),
  recordSuccess: vi.fn(),
  getClientIp: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getEffectiveLanAccessKey: mocks.getEffectiveLanAccessKey,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  setLanAuthCookie: mocks.setLanAuthCookie,
  verifyLanAuthToken: mocks.verifyLanAuthToken,
}));

vi.mock("@/lib/auth/loginLimiter", () => ({
  checkLock: mocks.checkLock,
  recordFail: mocks.recordFail,
  recordSuccess: mocks.recordSuccess,
  getClientIp: mocks.getClientIp,
}));

const { POST } = await import("../../src/app/api/auth/lan-verify/route.js");

describe("POST /api/auth/lan-verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkLock.mockReturnValue({ locked: false });
    mocks.getClientIp.mockReturnValue("192.168.0.222");
    mocks.getSettings.mockResolvedValue({ lanSharingEnabled: true });
    mocks.getEffectiveLanAccessKey.mockReturnValue("ar_lan_secret123");
    mocks.cookies.mockResolvedValue({ set: vi.fn() });
    mocks.recordFail.mockReturnValue({ remainingBeforeLock: 4 });
  });

  it("verifies matching LAN access key and sets auth cookie", async () => {
    const request = new Request("http://192.168.0.111:20127/api/auth/lan-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "ar_lan_secret123" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mocks.recordSuccess).toHaveBeenCalledWith("192.168.0.222");
    expect(mocks.setLanAuthCookie).toHaveBeenCalled();
  });

  it("rejects mismatched LAN access key with 401", async () => {
    const request = new Request("http://192.168.0.111:20127/api/auth/lan-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "wrong_key" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(response.body.error).toContain("Invalid LAN Hash Key");
    expect(mocks.recordFail).toHaveBeenCalledWith("192.168.0.222");
  });

  it("rejects when LAN sharing is disabled in settings with 403", async () => {
    mocks.getSettings.mockResolvedValue({ lanSharingEnabled: false });

    const request = new Request("http://192.168.0.111:20127/api/auth/lan-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "ar_lan_secret123" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("disabled");
  });

  it("returns 429 when client IP is locked by rate limiter", async () => {
    mocks.checkLock.mockReturnValue({ locked: true, retryAfter: 60 });

    const request = new Request("http://192.168.0.111:20127/api/auth/lan-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "ar_lan_secret123" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(429);
    expect(response.body.retryAfter).toBe(60);
  });
});
