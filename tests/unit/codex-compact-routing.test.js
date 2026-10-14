import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";

const credentials = { accessToken: "test", connectionId: "test-connection", providerSpecificData: {} };

afterEach(() => vi.clearAllMocks());

describe("Codex compact routing", () => {
  it("routes the first compact request to /compact without leaking _compact upstream", async () => {
    proxyAwareFetch.mockImplementation(async () => new Response("", { status: 200 }));
    const body = { model: "gpt-6.1-sol", input: "summarize", _compact: true };

    await getExecutor("codex").execute({ model: body.model, body, stream: true, credentials });

    expect(proxyAwareFetch).toHaveBeenCalledOnce();
    const [url, options] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses/compact");
    expect(JSON.parse(options.body)).not.toHaveProperty("_compact");
  });

  it("isolates URL and session state between Codex requests", async () => {
    proxyAwareFetch.mockImplementation(async () => new Response("", { status: 200 }));
    const compactExecutor = getExecutor("codex");
    const normalExecutor = getExecutor("codex");

    expect(hasSpecializedExecutor("codex")).toBe(true);
    expect(compactExecutor).not.toBe(normalExecutor);
    await Promise.all([
      compactExecutor.execute({ model: "gpt-6.1-sol", body: { model: "gpt-6.1-sol", input: "summary", _compact: true }, stream: true, credentials }),
      normalExecutor.execute({ model: "gpt-6.1-sol", body: { model: "gpt-6.1-sol", input: "hello" }, stream: true, credentials }),
    ]);

    expect(proxyAwareFetch.mock.calls.map(([url]) => url).sort()).toEqual([
      "https://chatgpt.com/backend-api/codex/responses",
      "https://chatgpt.com/backend-api/codex/responses/compact",
    ]);
  });
});
