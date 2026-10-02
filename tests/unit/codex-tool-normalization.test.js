import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CodexExecutor } from "../../open-sse/executors/codex.js";

function normalizeTools(tools, userText = "probe") {
  const executor = new CodexExecutor();
  const body = {
    model: "gpt-5.5",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: userText }] }],
    tools,
    stream: true,
  };

  executor.transformRequest("gpt-5.5", body, true, {
    connectionId: "test-codex-tools",
    providerSpecificData: {},
  });

  return body.tools;
}

describe("CodexExecutor tool normalization", () => {
  it("omits an unrequested goal token budget from flat and namespace tools", () => {
    const parameters = {
      type: "object",
      properties: {
        objective: { type: "string" },
        token_budget: { type: "integer", minimum: 1 },
      },
      required: ["objective", "token_budget"],
    };
    const tools = normalizeTools([
      { type: "function", name: "functions.create_goal", parameters },
      { type: "namespace", name: "functions", tools: [
        { type: "function", name: "create_goal", parameters },
      ] },
    ], "/goal Finish the refactor");

    for (const goal of [tools[0], tools[1].tools[0]]) {
      assert.equal(goal.parameters.properties.token_budget, undefined);
      assert.deepEqual(goal.parameters.required, ["objective"]);
    }
    assert.deepEqual(parameters.properties.token_budget, { type: "integer", minimum: 1 });
  });

  it("keeps goal token_budget when the user requests a token limit", () => {
    const parameters = {
      type: "object",
      properties: {
        objective: { type: "string" },
        token_budget: { type: "integer", minimum: 1 },
      },
      required: ["objective"],
    };
    const tools = normalizeTools([
      { type: "function", name: "create_goal", parameters },
    ], "/goal Finish the refactor with a limit of 4000 tokens");

    assert.deepEqual(tools[0].parameters.properties.token_budget, { type: "integer", minimum: 1 });
  });

  it("preserves Responses text.format for structured outputs", () => {
    const executor = new CodexExecutor();
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
      },
      required: ["title"],
    };
    const body = {
      model: "gpt-5.4-mini",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "test for session title" }] }],
      stream: true,
      metadata: { unsupported: true },
      text: {
        format: {
          type: "json_schema",
          name: "codex_output_schema",
          strict: true,
          schema,
        },
      },
    };

    executor.transformRequest("gpt-5.4-mini", body, true, {
      connectionId: "test-codex-structured-output",
      providerSpecificData: {},
    });

    assert.deepEqual(body.text, {
      format: {
        type: "json_schema",
        name: "codex_output_schema",
        strict: true,
        schema,
      },
    });
    assert.equal(body.metadata, undefined);
  });

  it("preserves Responses-native tool_search tools", () => {
    const tools = normalizeTools([
      {
        type: "tool_search",
        execution: "sync",
        description: "Discover deferred tools",
        parameters: { type: "object", properties: {} },
      },
      {
        type: "namespace",
        name: "codex_app",
        description: "app tools",
        tools: [
          {
            type: "function",
            name: "automation_update",
            description: "automation",
            parameters: { type: "object", properties: {} },
            defer_loading: true,
          },
        ],
      },
      {
        type: "function",
        name: "plain_fn",
        description: "plain",
        parameters: { type: "object", properties: {} },
      },
    ]);

    assert.deepEqual(tools.map((tool) => `${tool.type}:${tool.name || ""}`), [
      "tool_search:",
      "namespace:codex_app",
      "function:plain_fn",
    ]);
  });

  it("preserves hosted Responses tools", () => {
    const tools = normalizeTools([
      { type: "web_search", search_context_size: "medium" },
      { type: "image_generation", size: "1024x1024" },
      { type: "mcp", server_label: "docs", server_url: "https://example.com/mcp" },
      { type: "local_shell" },
      { type: "code_interpreter", container: { type: "auto" } },
      { type: "computer", display_width: 1024, display_height: 768, environment: "browser" },
    ]);

    assert.deepEqual(tools.map((tool) => tool.type), [
      "web_search",
      "image_generation",
      "mcp",
      "local_shell",
      "code_interpreter",
      "computer",
    ]);
  });

  it("strips only Unicode-property patterns rejected by Codex", () => {
    const unicodePattern = "^(?!__.*__$)[^\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]{1,200}$";
    const validPattern = "^[a-z][a-z0-9_-]{0,31}$";
    const sourceParameters = {
      type: "object",
      properties: {
        artifact: {
          type: "object",
          properties: {
            name: { type: "string", pattern: unicodePattern },
            slug: { type: "string", pattern: validPattern },
          },
        },
        // A property named "pattern" is data, not the schema keyword.
        pattern: { type: "string", pattern: validPattern },
      },
      allOf: [{ properties: { title: { type: "string", pattern: unicodePattern } } }],
    };
    const tools = normalizeTools([{
      type: "function",
      name: "Artifact",
      parameters: sourceParameters,
    }]);

    assert.equal(tools[0].parameters.properties.artifact.properties.name.pattern, undefined);
    assert.equal(tools[0].parameters.properties.artifact.properties.slug.pattern, validPattern);
    assert.equal(tools[0].parameters.properties.pattern.pattern, validPattern);
    assert.equal(tools[0].parameters.allOf[0].properties.title.pattern, undefined);
    // Copy-on-write: the caller's schema remains available for another provider.
    assert.equal(sourceParameters.properties.artifact.properties.name.pattern, unicodePattern);
  });

  it("keeps escaped literal property text and schema identity when no strip is needed", () => {
    const parameters = {
      type: "object",
      properties: {
        literal: { type: "string", pattern: "^\\\\p{Cc}$" },
        simple: { type: "string", pattern: "^[A-Z]+$" },
      },
    };
    const tools = normalizeTools([{ type: "function", name: "probe", parameters }]);

    assert.strictEqual(tools[0].parameters, parameters);
    assert.equal(tools[0].parameters.properties.literal.pattern, "^\\\\p{Cc}$");
  });

  it("sanitizes nested namespace function schemas", () => {
    const tools = normalizeTools([{
      type: "namespace",
      name: "agent",
      tools: [{
        type: "function",
        name: "Artifact",
        parameters: {
          type: "object",
          properties: { name: { type: "string", pattern: "^\\p{Cc}+$" } },
        },
      }],
    }]);

    assert.equal(tools[0].tools[0].parameters.properties.name.pattern, undefined);
  });

  it("preserves custom freeform tools with format payloads", () => {
    const tools = normalizeTools([
      {
        type: "custom",
        name: "apply_patch",
        description: "patch",
        format: { type: "grammar", syntax: "lark", definition: "start: /.+/" },
      },
    ]);

    assert.deepEqual(tools, [
      {
        type: "custom",
        name: "apply_patch",
        description: "patch",
        format: { type: "grammar", syntax: "lark", definition: "start: /.+/" },
      },
    ]);
  });
});
