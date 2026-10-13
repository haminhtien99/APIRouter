import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexModelCatalog } from "../../src/lib/codexModelCatalog.js";

test("Codex catalog exposes APIRouter models and combos in native /model", () => {
  const catalog = buildCodexModelCatalog([
    { id: "coding-main", owned_by: "combo" },
    { id: "cx/gpt-5-codex", owned_by: "cx", context_length: 200000 },
    { id: "coding-main", owned_by: "combo" },
  ]);

  assert.equal(catalog.models.length, 2);
  assert.deepEqual(catalog.models.map((model) => model.slug), ["coding-main", "cx/gpt-5-codex"]);
  assert.equal(catalog.models[0].description, "APIRouter combo");
  assert.equal(catalog.models[1].context_window, 200000);
  assert.equal(catalog.models[1].max_context_window, 200000);
  assert.equal(catalog.models[1].visibility, "list");
  assert.equal(catalog.models[1].supported_in_api, true);
});

test("Codex catalog preserves compatible template behavior while replacing identity", () => {
  const catalog = buildCodexModelCatalog(
    [{ id: "fast-combo", owned_by: "combo" }],
    {
      template: {
        slug: "built-in",
        display_name: "Built In",
        description: "Built in model",
        default_reasoning_level: "high",
        supported_reasoning_levels: [{ effort: "high", description: "High" }],
        shell_type: "unified_exec",
        visibility: "hide",
        supported_in_api: false,
        priority: 99,
      },
    },
  );

  assert.equal(catalog.models[0].slug, "fast-combo");
  assert.equal(catalog.models[0].display_name, "Fast Combo");
  assert.equal(catalog.models[0].default_reasoning_level, "high");
  assert.equal(catalog.models[0].visibility, "list");
  assert.equal(catalog.models[0].supported_in_api, true);
  assert.equal(catalog.models[0].priority, 0);
});

test("Codex catalog rejects an empty APIRouter model list", () => {
  assert.throws(() => buildCodexModelCatalog([]), /No APIRouter models or combos/);
});

test("Codex catalog uses each native model's cached prompts, reasoning and context limits", () => {
  const templates = [
    { slug: "gpt-6.1-sol", context_window: 500000, max_context_window: 872000,
      supported_reasoning_levels: [{ effort: "low" }, { effort: "ultra" }], default_reasoning_level: "low",
      model_messages: { persistent_instructions: "persistent", instructions_template: "Sol", permissions: { policy: "test" } },
      tool_mode: "code_mode_only", multi_agent_version: "v2", use_responses_lite: true },
    { slug: "gpt-6-luna", context_window: 272000,
      supported_reasoning_levels: [{ effort: "high" }, { effort: "max" }], default_reasoning_level: "high",
      model_messages: { instructions_template: "Luna" }, node_repl_auto_review_required: false },
  ];
  const catalog = buildCodexModelCatalog([
    { id: "cx/gpt-6.1-sol", owned_by: "cx", context_length: 272000 },
    { id: "cx/gpt-6-luna-review", owned_by: "cx" },
  ], { template: templates[0], templates });
  const [sol, luna] = catalog.models;
  assert.equal(sol.context_window, 500000);
  assert.equal(sol.max_context_window, 872000);
  assert.deepEqual(sol.model_messages, templates[0].model_messages);
  assert.equal(sol.tool_mode, "code_mode_only");
  assert.equal(sol.multi_agent_version, "v2");
  assert.equal(sol.use_responses_lite, false);
  assert.deepEqual(luna.supported_reasoning_levels, templates[1].supported_reasoning_levels);
  assert.equal(luna.model_messages.instructions_template, "Luna");
  assert.equal(luna.node_repl_auto_review_required, false);
});

test("Codex catalog advertises DeepSeek's own effort levels and input modalities", () => {
  const catalog = buildCodexModelCatalog([
    { id: "ds/deepseek-v4-pro", owned_by: "ds", context_length: 1000000, capabilities: { vision: false } },
    { id: "ds/deepseek-flash", owned_by: "ds", context_length: 1000000, capabilities: { vision: true } },
  ], { template: { default_reasoning_level: "medium", tool_mode: "code_mode_only" } });
  for (const model of catalog.models) {
    assert.deepEqual(model.supported_reasoning_levels.map(({ effort }) => effort), ["none", "low", "high", "max"]);
    assert.equal(model.default_reasoning_level, "high");
    assert.equal(model.context_window, 1000000);
    assert.equal(model.tool_mode, undefined);
  }
  assert.deepEqual(catalog.models[0].input_modalities, ["text"]);
  assert.deepEqual(catalog.models[1].input_modalities, ["text", "image"]);
});
