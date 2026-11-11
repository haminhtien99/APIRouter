import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { proxyAgent, readHosts, resolve4 } = vi.hoisted(() => ({
  proxyAgent: vi.fn(function (options) { this.options = options; }),
  readHosts: vi.fn(),
  resolve4: vi.fn(),
}));
vi.mock("undici", () => ({ ProxyAgent: proxyAgent }));
vi.mock("node:fs", () => ({ readFileSync: readHosts }));
vi.mock("dns", () => ({
  Resolver: class {
    setServers() {}
    resolve4(...args) { return resolve4(...args); }
  },
}));

let fetchMock;
let proxyAwareFetch;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  readHosts.mockReturnValue("127.0.0.1 localhost\n::1 localhost\n");
  resolve4.mockImplementation((_host, callback) => callback(new Error("test DNS unavailable")));
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "no_proxy", "GOOGLE_PROXY_URL"]) {
    vi.stubEnv(key, "");
  }
  fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
  vi.stubGlobal("fetch", fetchMock);
  ({ proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("optional outbound proxy routing", () => {
  it.each([
    "https://generativelanguage.googleapis.com/v1beta/models",
    "https://oauth2.googleapis.com/token",
    "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
    "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    "https://api.openai.com/v1",
    "http://127.0.0.1:20228/v1",
  ])("uses the normal connection for %s without a configured proxy", async (url) => {
    await proxyAwareFetch(url);
    expect(proxyAgent).not.toHaveBeenCalled();
    expect(resolve4).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(url, {});
  });

  it.each(["127.0.0.1", "::1"])("only attempts DNS bypass for an active %s hosts redirect", async address => {
    readHosts.mockReturnValue(`${address} daily-cloudcode-pa.googleapis.com # local MITM\n`);
    await proxyAwareFetch("https://daily-cloudcode-pa.googleapis.com/test");
    expect(resolve4).toHaveBeenCalledExactlyOnceWith(
      "daily-cloudcode-pa.googleapis.com", expect.any(Function),
    );
  });

  it("does not mistake a public hosts entry for a local MITM redirect", async () => {
    readHosts.mockReturnValue("142.250.1.1 daily-cloudcode-pa.googleapis.com\n");
    const url = "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent";
    await proxyAwareFetch(url);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(url, {});
  });

  it("ignores commented redirects and unrelated loopback domains", async () => {
    readHosts.mockReturnValue(
      "# 127.0.0.1 daily-cloudcode-pa.googleapis.com\n127.0.0.1 unrelated.example\n",
    );
    const url = "https://daily-cloudcode-pa.googleapis.com/test";
    await proxyAwareFetch(url);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(url, {});
  });

  it("keeps the normal path if the hosts file cannot be read", async () => {
    readHosts.mockImplementationOnce(() => { throw new Error("EACCES"); });
    const url = "https://daily-cloudcode-pa.googleapis.com/test";
    await proxyAwareFetch(url);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(url, {});
  });

  it("does not apply MITM bypass to a hostname containing a trusted name", async () => {
    readHosts.mockReturnValue(
      "127.0.0.1 daily-cloudcode-pa.googleapis.com.attacker.example\n",
    );
    const url = "https://daily-cloudcode-pa.googleapis.com.attacker.example/test";
    await proxyAwareFetch(url);
    expect(readHosts).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(url, {});
  });

  it("does not honor the removed Google-specific forced proxy setting", async () => {
    vi.stubEnv("GOOGLE_PROXY_URL", "http://127.0.0.1:10809");
    await proxyAwareFetch("https://generativelanguage.googleapis.com/v1beta/models");
    expect(proxyAgent).not.toHaveBeenCalled();
  });

  it("uses an explicitly configured proxy", async () => {
    await proxyAwareFetch("https://oauth2.googleapis.com/token", {}, {
      enabled: true, url: "http://127.0.0.1:8888",
    });
    expect(proxyAgent).toHaveBeenCalledWith({ uri: "http://127.0.0.1:8888" });
  });

  it("falls back to the normal connection unless strict proxy mode was requested", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:10809");
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("ok"));
    await proxyAwareFetch("https://generativelanguage.googleapis.com/v1beta/models");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models", {},
    );
  });

  it("preserves opt-in strict proxy behavior", async () => {
    const reason = new TypeError("fetch failed");
    fetchMock.mockRejectedValueOnce(reason);
    await expect(proxyAwareFetch("https://oauth2.googleapis.com/token", {}, {
      enabled: true, url: "http://127.0.0.1:8888", strictProxy: true,
    })).rejects.toMatchObject({ message: "[ProxyFetch] Required proxy failed", cause: reason });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors NO_PROXY for an environment proxy", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:10809");
    vi.stubEnv("NO_PROXY", ".googleapis.com");
    await proxyAwareFetch("https://oauth2.googleapis.com/token");
    expect(proxyAgent).not.toHaveBeenCalled();
  });

  it("does not retry a cancelled proxy fetch over a direct connection", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:10809");
    const ctrl = new AbortController();
    const reason = new Error("client disconnected");
    fetchMock.mockImplementationOnce(async () => {
      ctrl.abort(reason);
      throw reason;
    });
    await expect(proxyAwareFetch("https://api.openai.com/v1", { signal: ctrl.signal }))
      .rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not open a connection for an already aborted request", async () => {
    const reason = new Error("cancelled");
    await expect(proxyAwareFetch("https://oauth2.googleapis.com/token", {
      signal: AbortSignal.abort(reason),
    })).rejects.toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
