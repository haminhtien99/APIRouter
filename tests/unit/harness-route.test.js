import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runtimeStatus: vi.fn() }));
vi.mock("@/lib/dataDir", () => ({ DATA_DIR: "/unused" }));
vi.mock("@/lib/harness/runtime.mjs", () => ({
  harnessStateFile: () => "/unused/harness-web.json",
  runtimeStatus: mocks.runtimeStatus,
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, options) => ({ body, status: options?.status || 200, headers: options?.headers }),
  },
}));
const { GET } = await import("../../src/app/api/harness/route.js");

describe("harness dashboard connection", () => {
  beforeEach(() => {
    mocks.runtimeStatus.mockReset();
    mocks.runtimeStatus.mockResolvedValue({
      status: "ready", launchUrl: "http://127.0.0.1:3081/?token=fixture",
    });
  });

  it("uses the browser Host rather than Next's internal localhost URL", async () => {
    const response = await GET(new Request("http://localhost:20229/api/harness", {
      headers: { host: "127.0.0.1:20229" },
    }));
    expect(response.body.launchUrl).toBe("http://127.0.0.1:3081/?token=fixture");
    expect(response.headers["Cache-Control"]).toBe("no-store");
    expect(response.headers["Referrer-Policy"]).toBe("no-referrer");
  });

  it("keeps localhost requests same-site with the embedded workspace", async () => {
    const response = await GET(new Request("http://localhost:20229/api/harness", {
      headers: { host: "localhost:20229" },
    }));
    expect(response.body.launchUrl).toBe("http://localhost:3081/?token=fixture");
  });

  it("rejects non-loopback hostnames without returning the credential", async () => {
    const response = await GET(new Request("http://localhost:20229/api/harness", {
      headers: { host: "router.example" },
    }));
    expect(response.status).toBe(409);
    expect(response.body.launchUrl).toBeUndefined();
  });

  it("reports unreadable connection files without leaking file contents", async () => {
    mocks.runtimeStatus.mockRejectedValue(new Error("private-file-contents"));
    const response = await GET(new Request("http://localhost:20229/api/harness"));
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain("private-file-contents");
  });
});
