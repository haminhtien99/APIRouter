import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

test("combo picker chooses a provider before showing a paginated model list", async () => {
  const inputPath = require.resolve("../../cli/src/cli/utils/input.js");
  const selectorPath = require.resolve("../../cli/src/cli/utils/modelSelector.js");
  const previous = [inputPath, selectorPath].map((path) => require.cache[path]);
  const choices = [2, 13, 14, 1];
  const menus = [];

  try {
    require.cache[inputPath] = {
      id: inputPath,
      filename: inputPath,
      loaded: true,
      exports: {
        prompt: async () => { throw new Error("Provider selection must use a menu"); },
        selectMenu: async (title, items, _defaultIndex, subtitle) => {
          menus.push({ title, labels: items.map((item) => item.label), subtitle });
          return choices.shift();
        },
      },
    };
    delete require.cache[selectorPath];

    const { selectModelFromList } = require(selectorPath);
    const models = Array.from({ length: 105 }, (_, i) => `cx/model-${String(i + 1).padStart(3, "0")}`);
    const result = await selectModelFromList("Add Model", "", {
      providerFirst: true,
      excludeCombos: true,
      catalog: {
        combos: ["existing-combo"],
        groups: { ag: ["ag/claude-test"], cx: models },
      },
    });

    assert.equal(result, "cx/model-025");
    assert.equal(choices.length, 0);
    assert.match(menus[0].title, /Choose provider/);
    assert.deepEqual(menus[0].labels, [
      "← Back",
      "Antigravity (1 models)",
      "OpenAI Codex (105 models)",
    ]);
    assert.match(menus[1].title, /OpenAI Codex/);
    assert.equal(menus[1].labels.length, 15);
    assert.equal(menus[3].subtitle, "105 models · Page 3/9");
    assert.ok(!menus.flatMap((menu) => menu.labels).includes("ag/claude-test"));
    assert.ok(!menus.flatMap((menu) => menu.labels).includes("cx/model-105"));
    assert.ok(!menus.flatMap((menu) => menu.labels).includes("existing-combo"));
  } finally {
    [inputPath, selectorPath].forEach((path, index) => {
      if (previous[index]) require.cache[path] = previous[index];
      else delete require.cache[path];
    });
  }
});

test("creating a combo saves selected routed model IDs", async () => {
  const apiPath = require.resolve("../../cli/src/cli/api/client.js");
  const inputPath = require.resolve("../../cli/src/cli/utils/input.js");
  const displayPath = require.resolve("../../cli/src/cli/utils/display.js");
  const selectorPath = require.resolve("../../cli/src/cli/utils/modelSelector.js");
  const combosPath = require.resolve("../../cli/src/cli/menus/combos.js");
  const paths = [apiPath, inputPath, displayPath, selectorPath, combosPath];
  const previous = paths.map((path) => require.cache[path]);
  const answers = ["my-combo", "second-combo"];
  let picks = ["cx/model-a", "ag/model-b"];
  let menuChoices = [1, 0];
  const draftMenus = [];
  let saved;

  try {
    require.cache[apiPath] = {
      id: apiPath,
      filename: apiPath,
      loaded: true,
      exports: {
        getProviders: async () => ({
          success: true,
          data: { connections: [{ provider: "codex", isActive: true }] },
        }),
        getAvailableModels: async () => ({
          success: true,
          data: { data: [
            { id: "cx/model-a", owned_by: "cx" },
            { id: "ag/model-b", owned_by: "ag" },
            { id: "existing-combo", owned_by: "combo" },
          ] },
        }),
        createCombo: async (value) => { saved = value; return { success: true }; },
        getSettings: async () => ({ success: true, data: {} }),
        updateSettings: async () => ({ success: true }),
      },
    };
    require.cache[inputPath] = {
      id: inputPath,
      filename: inputPath,
      loaded: true,
      exports: {
        prompt: async () => answers.shift(),
        select: async () => { throw new Error("Strategy should stay at its default until changed"); },
        selectMenu: async (_title, items) => {
          draftMenus.push(items.map((item) => item.label));
          return menuChoices.shift();
        },
        confirm: async () => { throw new Error("Saving should not require cancellation confirmation"); },
        pause: async () => {},
      },
    };
    require.cache[displayPath] = {
      id: displayPath,
      filename: displayPath,
      loaded: true,
      exports: { clearScreen: () => {}, showStatus: () => {}, showHeader: () => {} },
    };
    require.cache[selectorPath] = {
      id: selectorPath,
      filename: selectorPath,
      loaded: true,
      exports: {
        selectModelFromList: async (_title, _current, options) => {
          assert.equal(options.providerFirst, true);
          assert.equal(options.excludeCombos, true);
          assert.deepEqual(options.catalog, {
            combos: [],
            groups: { cx: ["cx/model-a"], ag: ["ag/model-b"] },
          });
          return picks.shift();
        },
      },
    };
    delete require.cache[combosPath];

    const { handleCreateCombo } = require(combosPath);
    await handleCreateCombo();
    assert.deepEqual(saved, {
      name: "my-combo",
      models: ["cx/model-a", "ag/model-b"],
    });
    assert.deepEqual(draftMenus[0].slice(0, 2), ["💾 Save combo", "＋ Add model"]);
    assert.equal(menuChoices.length, 0);

    // Backing out of the provider picker keeps the existing draft available to save.
    picks = ["cx/model-a", null];
    menuChoices = [1, 0];
    await handleCreateCombo();
    assert.deepEqual(saved, {
      name: "second-combo",
      models: ["cx/model-a"],
    });
    assert.equal(answers.length, 0);
  } finally {
    paths.forEach((path, index) => {
      if (previous[index]) require.cache[path] = previous[index];
      else delete require.cache[path];
    });
  }
});
