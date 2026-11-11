import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the import itself so only dependency-load failures trigger fallback.
const state = vi.hoisted(() => ({ loadError: null, createSession: vi.fn(), nativeFetch: vi.fn() }));
vi.mock("wreq-js", () => {
  if (state.loadError) throw state.loadError;
  return { createSession: state.createSession };
});
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: state.nativeFetch }));

afterEach(() => {
  state.loadError = null;
  vi.clearAllMocks();
  vi.resetModules();
});

async function load() {
  return (await import("../../open-sse/services/opencodeTlsClient.js")).opencodeTlsFetch;
}

describe("optional OpenCode TLS transport fallback", () => {
  it.each(["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"])("uses original-fetch helper only for missing dependency (%s)", async code => {
    state.loadError = Object.assign(new Error("Cannot find wreq-js binding"), { code });
    const response = new Response("native");
    state.nativeFetch.mockResolvedValueOnce(response);
    const fetch = await load();
    const options = { method: "POST", body: "{}", signal: new AbortController().signal };
    expect(await fetch("https://opencode.ai/test", options)).toBe(response);
    expect(state.nativeFetch).toHaveBeenCalledExactlyOnceWith("https://opencode.ai/test", options, { enabled: false, url: "", strictProxy: true });
  });
  it("preserves a selected proxy and propagates native/proxy failure without direct retry", async () => {
    state.loadError = Object.assign(new Error("missing dependency"), { code: "MODULE_NOT_FOUND" });
    const error = new Error("proxy failed");
    state.nativeFetch.mockRejectedValueOnce(error);
    await expect((await load())("https://opencode.ai/test", {}, "http://proxy:8080")).rejects.toBe(error);
    expect(state.nativeFetch).toHaveBeenCalledExactlyOnceWith("https://opencode.ai/test", {}, { enabled: true, url: "http://proxy:8080", strictProxy: true });
  });
  it("does not fall back when session initialization fails, even with a missing-module error", async () => {
    const error = Object.assign(new Error("session initialization failed"), { code: "MODULE_NOT_FOUND" });
    state.createSession.mockRejectedValueOnce(error);
    await expect((await load())("https://opencode.ai/test", {})).rejects.toBe(error);
    expect(state.nativeFetch).not.toHaveBeenCalled();
  });
  it("does not fall back for a TLS request or proxy failure", async () => {
    const error = new Error("TLS connection failed");
    state.createSession.mockResolvedValueOnce({ fetch: vi.fn().mockRejectedValueOnce(error) });
    await expect((await load())("https://opencode.ai/test", {}, "http://proxy:8080")).rejects.toBe(error);
    expect(state.nativeFetch).not.toHaveBeenCalled();
  });
  it("does not mask non-module dependency initialization errors", async () => {
    state.loadError = new Error("package initialization failed");
    await expect((await load())("https://opencode.ai/test", {})).rejects.toBeTruthy();
    expect(state.nativeFetch).not.toHaveBeenCalled();
  });
  it("honors cancellation before loading dependencies or falling back", async () => {
    const controller = new AbortController();
    const error = new Error("cancelled");
    controller.abort(error);
    await expect((await load())("https://opencode.ai/test", { signal: controller.signal })).rejects.toBe(error);
    expect(state.createSession).not.toHaveBeenCalled();
    expect(state.nativeFetch).not.toHaveBeenCalled();
  });
});
