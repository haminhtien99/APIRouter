import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { buildUpdatedComboStrategies } = require("../../cli/src/cli/menus/combos.js");

test("Terminal combo strategy stores round-robin and fusion settings", () => {
  const roundRobin = buildUpdatedComboStrategies({}, "coding-main", "round-robin");
  assert.deepEqual(roundRobin, {
    "coding-main": { fallbackStrategy: "round-robin" },
  });

  const fusion = buildUpdatedComboStrategies(roundRobin, "coding-main", "fusion", "cx/gpt-5.6-sol");
  assert.deepEqual(fusion, {
    "coding-main": {
      fallbackStrategy: "fusion",
      judgeModel: "cx/gpt-5.6-sol",
    },
  });
});

test("Terminal combo strategy removes settings for default fallback", () => {
  const updated = buildUpdatedComboStrategies({
    "coding-main": { fallbackStrategy: "fusion", judgeModel: "cx/gpt-5.6-sol" },
    other: { fallbackStrategy: "round-robin" },
  }, "coding-main", "fallback");

  assert.deepEqual(updated, {
    other: { fallbackStrategy: "round-robin" },
  });
});
