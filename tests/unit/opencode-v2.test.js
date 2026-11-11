import { describe, it, expect, vi } from "vitest";
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { OpenCodeExecutor, translateSessionId } from "../../open-sse/executors/opencode.js";

import { applyFingerprintTools, restoreToolNames } from "../../open-sse/utils/opencodeFingerprint.js";

describe("OpenCode V2 compatibility", () => {
  it("normalizes Claude fingerprint schemas and appends only Claude-shaped tools", () => {
    const body = { messages: [], tools: [{ name: "read", description: "Read", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }] };
    applyFingerprintTools(body, false, { claude: true });
    expect(body.tools.map(tool => tool.name)).toEqual(["read", "shell"]);
    for (const tool of body.tools) {
      expect(tool.input_schema.type).toBe("object");
      expect(tool).not.toHaveProperty("parameters");
      expect(tool).not.toHaveProperty("function");
      expect(tool).not.toHaveProperty("type");
    }
    expect(body.tools[0].input_schema.properties).toHaveProperty("offset");
    const again = { messages: [], tools: body.tools };
    applyFingerprintTools(again, false, { claude: true });
    expect(again.tools).toHaveLength(2);
  });
  it("preserves incompatible Claude schemas under aliases", () => {
    const input_schema = { type: "object", properties: { filename: { type: "string" } } };
    const body = { messages: [], tools: [{ name: "read", input_schema }] };
    const map = applyFingerprintTools(body, false, { claude: true });
    expect(body.tools[0]).toEqual({ name: "read_client", input_schema });
    expect(map.get("read_client")).toBe("read");
    expect(body.tools.slice(1).map(tool => tool.name)).toEqual(["read", "shell"]);
    expect(body.tools.slice(1).every(tool => !!tool.input_schema && !tool.function)).toBe(true);
  });
  it("injects synthetic paths rather than gateway cwd or custom tmp directory", async () => {
    const previous = process.env.TMPDIR;
    process.env.TMPDIR = "/private/gateway-temp-secret";
    try {
      vi.resetModules();
      const { applyEnvFingerprint } = await import("../../open-sse/utils/opencodeFingerprint.js");
      const body = {};
      applyEnvFingerprint(body, true);
      expect(body.instructions).toContain("Working directory: /workspace");
      expect(body.instructions).toContain("/tmp/opencode");
      expect(body.instructions).not.toContain(process.cwd());
      expect(body.instructions).not.toContain(process.env.TMPDIR);
    } finally {
      if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous;
    }
  });
  it.each(["application/json", "text/event-stream"])("sanitizes rewritten %s response framing and hop-by-hop headers", async contentType => {
    const payload = JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "read_client" } }] } }] });
    proxyAwareFetch.mockResolvedValueOnce(new Response(contentType === "application/json" ? payload : `data: ${payload}\n\n`, { statusText: "OK", headers: {
      "content-type": contentType, "content-length": "999", "content-encoding": "gzip", connection: "keep-alive, x-internal-hop", "x-internal-hop": "secret", "keep-alive": "timeout=5", "transfer-encoding": "chunked", trailer: "digest", te: "trailers", upgrade: "h2c", "proxy-connection": "close", "proxy-authenticate": "Basic", "proxy-authorization": "secret", "x-request-id": "req-safe",
    } }));
    const result = await new OpenCodeExecutor().execute({ model: "big-pickle", credentials: {}, stream: true, body: { messages: [], tools: [{ type: "function", function: { name: "read", parameters: { type: "object", properties: { filename: { type: "string" } } } } }] } });
    expect(await result.response.text()).toContain('"name":"read"');
    for (const name of ["content-length", "content-encoding", "connection", "x-internal-hop", "keep-alive", "transfer-encoding", "trailer", "te", "upgrade", "proxy-connection", "proxy-authenticate", "proxy-authorization"]) expect(result.response.headers.has(name)).toBe(false);
    expect(result.response.headers.get("content-type")).toBe(contentType);
    expect(result.response.headers.get("x-request-id")).toBe("req-safe");
    expect(result.response.statusText).toBe("OK");
  });
  it.each(["deepseek-v4.1-flash-free", "kimi-k2.5"])("restores JSON tool aliases after %s reasoning clones", async model => {
    proxyAwareFetch.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "read_client", arguments: "{}" } }] } }] }), { headers: { "content-type": "application/json" } }));
    const body = { messages: [{ role: "assistant", content: "", tool_calls: [{ function: { name: "read", arguments: "{}" } }] }], tools: [{ type: "function", function: { name: "read", parameters: { type: "object", properties: { filename: { type: "string" } } } } }] };
    const result = await new OpenCodeExecutor().execute({ model, body, credentials: {}, stream: true });
    expect(result.transformedBody).not.toBe(body);
    expect((await result.response.json()).choices[0].message.tool_calls[0].function.name).toBe("read");
  });
  it("aliases Claude tool-use history while preserving tool results", () => {
    const resultBlock = { type: "tool_result", tool_use_id: "call_1", content: "ok" };
    const body = { tools: [{ name: "terminal", input_schema: { type: "object", properties: {} } }], messages: [{ role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "terminal", input: {} }] }, { role: "user", content: [resultBlock] }] };
    applyFingerprintTools(body, false, { claude: true });
    expect(body.messages[0].content[0].name).toBe("run_command");
    expect(body.messages[1].content[0]).toBe(resultBlock);
  });
  it.each(["response.completed", "response.done"])("restores nested output in %s", type => {
    const payload = { type, response: { output: [{ type: "function_call", name: "read_client", arguments: "{}" }] } };
    expect(restoreToolNames(payload, new Map([["read_client", "read"]])).response.output[0].name).toBe("read");
    expect(payload.response.output[0].name).toBe("read_client");
  });
  it("preserves Harness tool schemas, choices and history under stable wire aliases", () => {
    const tool = { type: "function", function: { name: "subagent_fork", description: "Delegate", parameters: { type: "object", properties: { prompt: { type: "string" } } } } };
    const body = { tools: [tool], messages: [{ role: "assistant", tool_calls: [{ function: { name: "subagent_fork", arguments: "{}" } }] }], tool_choice: { type: "function", function: { name: "subagent_fork" } } };
    const map = applyFingerprintTools(body, false);
    const alias = body.tools[0].function.name;
    expect(alias).toMatch(/^client_[0-9a-f]{16}$/);
    expect(body.tools[0].function.parameters).toEqual(tool.function.parameters);
    expect(body.tool_choice.function.name).toBe(alias);
    expect(body.messages.find(m => m.role === "assistant").tool_calls[0].function.name).toBe(alias);
    const second = { tools: [tool], messages: [] };
    applyFingerprintTools(second, false);
    expect(second.tools[0].function.name).toBe(alias);
    expect(restoreToolNames({ choices: [{ delta: { tool_calls: [{ function: { name: alias } }] } }] }, map).choices[0].delta.tool_calls[0].function.name).toBe("subagent_fork");
  });
  it("sends matching affinity headers and omits the obsolete request header", () => {
    const headers = new OpenCodeExecutor().buildHeaders({ rawHeaders: { "x-opencode-request": "old" } });
    expect(headers["x-opencode-session-id"]).toBe(headers["x-opencode-session"]);
    expect(headers["x-session-affinity"]).toBe(headers["x-opencode-session"]);
    expect(headers).not.toHaveProperty("x-opencode-request");
  });
  it("uses a real timestamp for translated sessions and reuses the ID", () => {
    const now = Date.now();
    const id = translateSessionId("v2-timestamp-test");
    const timestamp = Number((~BigInt(`0x${id.slice(4, 16)}`) & ((1n << 48n) - 1n)) >> 12n);
    expect(Math.abs(timestamp - (now % 2 ** 36))).toBeLessThan(100);
    expect(translateSessionId("v2-timestamp-test")).toBe(id);
  });
  it.each(["big-pickle", "deepseek-v4.1-flash-free", "kimi-k2.5"])("restores %s tool aliases across fragmented SSE without buffering", async model => {
    const text = 'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"read_client","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(text);
    proxyAwareFetch.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) {
      c.enqueue(bytes.slice(0, 35)); c.enqueue(bytes.slice(35)); c.close();
    } }), { headers: { "content-type": "text/event-stream" } }));
    const result = await new OpenCodeExecutor().execute({ model, credentials: {}, stream: true,
      body: { messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "read", parameters: { type: "object", properties: { filename: { type: "string" } } } } }] } });
    const output = await result.response.text();
    expect(output).toContain('"name":"read"');
    expect(output).not.toContain("read_client");
    expect(output).toContain("[DONE]");
    expect(proxyAwareFetch.mock.calls.at(-1)[3]).toBeTypeOf("function");
  });
});
