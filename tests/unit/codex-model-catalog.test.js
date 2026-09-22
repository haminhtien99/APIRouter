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
