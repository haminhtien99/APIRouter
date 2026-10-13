import { describe, expect, it } from "vitest";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("DeepSeek native Responses routing", () => {
  it("selects the matching endpoint and bearer authentication", () => {
    const runtimeTransport = resolveTransport("deepseek", "openai-responses");
    const executor = new DefaultExecutor("deepseek");
    const credentials = { apiKey: "test-key", runtimeTransport };
    expect(runtimeTransport.format).toBe("openai-responses");
    expect(executor.buildUrl("deepseek-flash", true, 0, credentials)).toBe("https://api.deepseek.com/responses");
    expect(executor.buildHeaders(credentials).Authorization).toBe("Bearer test-key");
    expect(resolveTransport("deepseek", "openai").baseUrl).toContain("/chat/completions");
    expect(resolveTransport("deepseek", "claude").baseUrl).toContain("/anthropic/v1/messages");
  });

  it.each([
    ["none", "none"], ["low", "low"], ["medium", "high"], ["high", "high"], ["xhigh", "max"], ["max", "max"], ["ultra", "max"],
  ])("normalizes %s to Responses effort %s and preserves tool history", (effort, expected) => {
    const input = [
      { role: "user", content: "Fix the file" },
      { type: "reasoning", content: [{ type: "reasoning_text", text: "Check the file" }] },
      { type: "custom_tool_call", call_id: "patch", name: "apply_patch", input: "*** Begin Patch\n*** End Patch" },
      { type: "custom_tool_call_output", call_id: "patch", output: "Success" },
    ];
    const body = { model: "deepseek-flash", input, reasoning: { effort, summary: "none" } };
    const result = translateRequest("openai-responses", "openai-responses", body.model, body, true, {}, "deepseek");
    expect(result.input).toEqual(input);
    expect(result.reasoning).toEqual({ effort: expected, summary: "none" });
    expect(result.reasoning_effort).toBeUndefined();
    expect(result.thinking).toBeUndefined();
  });

  it("uses the suffix to disable thinking even when the request asks for max", () => {
    const result = translateRequest("openai-responses", "openai-responses", "deepseek-v4-pro(none)", {
      input: "Hi", reasoning: { effort: "max" },
    }, true, {}, "deepseek");
    expect(result.reasoning.effort).toBe("none");
  });

  it("keeps chat thinking fields on the chat endpoint", () => {
    const result = translateRequest("openai", "openai", "deepseek-flash", {
      messages: [{ role: "user", content: "Hi" }], reasoning_effort: "low",
    }, true, {}, "deepseek");
    expect(result.thinking).toEqual({ type: "enabled" });
    expect(result.reasoning_effort).toBe("low");
    expect(result.reasoning).toBeUndefined();
  });

  it("advertises official token limits and the current Flash alias's vision", () => {
    expect(getCapabilitiesForModel("deepseek", "deepseek-v4-pro")).toMatchObject({ vision: false, contextWindow: 1000000, maxOutput: 384000 });
    for (const model of ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]) {
      expect(getCapabilitiesForModel("deepseek", model)).toMatchObject({ vision: true, contextWindow: 1000000, maxOutput: 384000 });
    }
  });
});
