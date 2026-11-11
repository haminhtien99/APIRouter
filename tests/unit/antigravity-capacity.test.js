import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: fetchMock,
}));

import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { applyThinking, stripThinkingSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";

const capacityError = {
  error: {
    code: 503,
    message: "No capacity available for model gemini-3.8-flash-high on the server",
    status: "UNAVAILABLE",
    details: [{
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      reason: "MODEL_CAPACITY_EXHAUSTED",
      domain: "cloudcode-pa.googleapis.com",
      metadata: {
        model: "gemini-3.8-flash-high",
        OVERLOADED_TOO_MANY_RETRIES_PER_REQUEST: "true",
      },
    }],
  },
};

beforeEach(() => fetchMock.mockReset());

describe("Antigravity High capacity error handling", () => {
  it.each([503, 400])("preserves HTTP %s without replaying or changing the High model", async status => {
    const error = status === 503 ? capacityError : {
      error: { code: 400, status: "INVALID_ARGUMENT", message: "Invalid tool schema" },
    };
    fetchMock.mockResolvedValueOnce(Response.json(error, { status }));
    const model = "gemini-3.8-flash-high";
    const upstreamModel = getModelUpstreamId("ag", model);
    const body = {
      model: stripThinkingSuffix(upstreamModel),
      request: {
        contents: [{ role: "user", parts: [{ text: "Reply OK." }] }],
        generationConfig: { maxOutputTokens: 2048 },
      },
    };
    applyThinking("antigravity", upstreamModel, body, "antigravity");
    const result = await new AntigravityExecutor().execute({
      model, body, stream: true,
      credentials: { accessToken: "test-token", projectId: "test-project" },
    });

    expect(result.response.status).toBe(status);
    expect(await result.response.json()).toEqual(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.model).toBe(model);
    expect(sent.request.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
    expect(fetchMock.mock.calls[0][2]).toBeNull();
  });
});
