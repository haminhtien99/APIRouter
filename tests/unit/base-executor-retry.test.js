// Locks BaseExecutor.execute retry/fallback behavior (docs 04 GAP #1, docs 11 §7).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the network layer so we can script upstream responses.
const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");

function res(status) {
  return { status, headers: { get: () => "" } };
}

function makeExec(config) {
  const ex = new BaseExecutor("test", config);
  // make headers trivial; credentials empty
  return ex;
}

const creds = { apiKey: "k" };

beforeEach(() => fetchMock.mockReset());
afterEach(() => vi.useRealTimers());

describe("BaseExecutor.execute — retry by status (config-driven)", () => {
  it("returns an invalid request without retrying the same payload", async () => {
    const ex = makeExec({ baseUrl: "https://x/api" });
    fetchMock.mockResolvedValueOnce(res(400));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries 502 `attempts` times then succeeds", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 3, delayMs: 0 } } });
    fetchMock
      .mockResolvedValueOnce(res(502))
      .mockResolvedValueOnce(res(502))
      .mockResolvedValueOnce(res(200));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops after exhausting 502 attempts on a single url and throws", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 2, delayMs: 0 } } });
    fetchMock.mockResolvedValue(res(502));
    // single url: 1 initial + 2 retries = 3 calls, then returns the 502 response (no fallback url)
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("BaseExecutor.execute — baseUrls fallback", () => {
  it("falls over to the next url on 429 (shouldRetry)", async () => {
    const ex = makeExec({ baseUrls: ["https://a/api", "https://b/api"], retry: { 429: { attempts: 0 } } });
    fetchMock
      .mockResolvedValueOnce(res(429)) // url[0] → fallback
      .mockResolvedValueOnce(res(200)); // url[1] ok
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(200);
    expect(out.url).toBe("https://b/api");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("BaseExecutor.execute — network error retry/fallback", () => {
  it("does not retry client cancellation with a custom Error reason", async () => {
    const ex = makeExec({ baseUrl: "https://x/api" });
    const ctrl = new AbortController();
    const reason = new Error("client disconnected");
    fetchMock.mockImplementationOnce(async () => {
      ctrl.abort(reason);
      throw reason;
    });
    await expect(ex.execute({
      model: "m", body: {}, stream: true, credentials: creds, signal: ctrl.signal,
    })).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not start an upstream request when already cancelled", async () => {
    const ex = makeExec({ baseUrl: "https://x/api" });
    const signal = AbortSignal.abort(new Error("cancelled"));
    await expect(ex.execute({
      model: "m", body: {}, stream: true, credentials: creds, signal,
    })).rejects.toThrow("cancelled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels retry backoff immediately and releases the failed body", async () => {
    vi.useFakeTimers();
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 503: { attempts: 1, delayMs: 30000 } } });
    const ctrl = new AbortController();
    const cancel = vi.fn().mockResolvedValue(undefined);
    fetchMock.mockResolvedValueOnce({ ...res(503), body: { cancel } });
    const result = ex.execute({
      model: "m", body: {}, stream: true, credentials: creds, signal: ctrl.signal,
    });
    const rejected = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
    ctrl.abort(new Error("client disconnected"));
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries an internal header timeout even when its reason is an Error", async () => {
    vi.useFakeTimers();
    const ex = makeExec({
      baseUrl: "https://x/api", timeoutMs: 10, retry: { 502: { attempts: 1, delayMs: 0 } },
    });
    fetchMock.mockImplementationOnce((_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })).mockResolvedValueOnce(res(200));
    const result = ex.execute({ model: "m", body: {}, stream: true, credentials: creds });
    await vi.advanceTimersByTimeAsync(11);
    expect((await result).response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("maps network exception to 502 retry config", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 1, delayMs: 0 } } });
    fetchMock
      .mockImplementationOnce(async () => { throw new Error("ECONNRESET"); })
      .mockResolvedValueOnce(res(200));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the only url fails with network error and no retries left", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 0 } } });
    // mockImplementationOnce (not persistent) avoids vitest flagging a reused rejection.
    fetchMock.mockImplementationOnce(async () => { throw new Error("boom"); });
    let thrown = null;
    try {
      await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.message).toBe("boom");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("BaseExecutor.execute — computeRetryDelay hook veto", () => {
  it("only invokes computeRetryDelay when status has retry config", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 503: { attempts: 1, delayMs: 0 } } });
    ex.computeRetryDelay = vi.fn().mockResolvedValue(0);
    fetchMock.mockResolvedValueOnce(res(500));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(500);
    expect(ex.computeRetryDelay).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hook returning false skips retry (uses fallback path)", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 429: { attempts: 5, delayMs: 0 } } });
    ex.computeRetryDelay = vi.fn().mockResolvedValue(false);
    fetchMock.mockResolvedValueOnce(res(429));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    // hook vetoes retry → no fallback url → returns the 429 response as-is
    expect(out.response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
