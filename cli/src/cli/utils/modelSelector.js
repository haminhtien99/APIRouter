const api = require("../api/client");
const { prompt, selectMenu } = require("./input");
const { clearScreen } = require("./display");

// Provider alias order: OAuth first, then API Key (matches ModelSelectModal)
const PROVIDER_ALIAS_ORDER = [
  "cc", "ag", "cx", "if", "qw", "gc", "gh", "kr",
  "deepseek", "ds", "openrouter", "glm", "kimi", "minimax", "openai", "anthropic", "gemini"
];

// Alias to display name mapping
const PROVIDER_ALIAS_NAMES = {
  cc: "Claude Code",
  ag: "Antigravity", 
  cx: "OpenAI Codex",
  if: "iFlow AI",
  qw: "Qwen Code",
  gc: "Gemini CLI",
  gh: "GitHub Copilot",
  kr: "Kiro AI",
  deepseek: "DeepSeek",
  ds: "DeepSeek",
  openrouter: "OpenRouter",
  glm: "GLM Coding",
  kimi: "Kimi Coding",
  minimax: "Minimax Coding",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini"
};

/**
 * Get all available models grouped by provider + combos
 * @returns {Promise<{combos: Array, groups: Object}>}
 */
async function getAvailableModelsGrouped() {
  const result = await api.getAvailableModels();
  if (!result.success) return { combos: [], groups: {} };
  
  const models = result.data?.data || [];
  const combos = [];
  const groups = {};
  
  models.forEach(m => {
    if (m.owned_by === "combo") {
      combos.push(m.id);
    } else {
      const provider = m.owned_by;
      if (!groups[provider]) {
        groups[provider] = [];
      }
      groups[provider].push(m.id);
    }
  });
  
  return { combos, groups };
}

async function selectModelByProvider(title, currentValue, categories) {
  const providerPageSize = 12;
  const modelPageSize = 12;
  let providerPage = 0;

  while (true) {
    const providerPages = Math.ceil(categories.length / providerPageSize);
    const visibleProviders = categories.slice(
      providerPage * providerPageSize,
      (providerPage + 1) * providerPageSize,
    );
    const providerActions = [
      { type: "cancel", label: "← Back" },
      ...visibleProviders.map((provider) => ({
        type: "provider",
        provider,
        label: `${provider.name} (${provider.models.length} models)`,
      })),
    ];
    if (providerPage > 0) providerActions.push({ type: "previous", label: "← Previous providers" });
    if (providerPage + 1 < providerPages) providerActions.push({ type: "next", label: "Next providers →" });

    const providerChoice = await selectMenu(
      `${title} · Choose provider`,
      providerActions,
      1,
      `Page ${providerPage + 1}/${providerPages}`,
      currentValue ? `Selected: ${currentValue}` : "",
    );
    if (providerChoice < 0 || providerActions[providerChoice]?.type === "cancel") return null;
    const providerAction = providerActions[providerChoice];
    if (providerAction.type === "previous") { providerPage--; continue; }
    if (providerAction.type === "next") { providerPage++; continue; }

    const provider = providerAction.provider;
    let modelPage = 0;
    let query = "";
    while (true) {
      const matchedModels = provider.models.filter((model) =>
        model.toLowerCase().includes(query.toLowerCase())
      );
      const modelPages = Math.max(1, Math.ceil(matchedModels.length / modelPageSize));
      modelPage = Math.min(modelPage, modelPages - 1);
      const visibleModels = matchedModels.slice(
        modelPage * modelPageSize,
        (modelPage + 1) * modelPageSize,
      );
      const modelActions = [
        { type: "back", label: "← Providers" },
        ...visibleModels.map((model) => ({ type: "model", model, label: model })),
      ];
      if (modelPage > 0) modelActions.push({ type: "previous", label: "← Previous models" });
      if (modelPage + 1 < modelPages) modelActions.push({ type: "next", label: "Next models →" });
      modelActions.push({ type: "search", label: "🔍 Search models in this provider" });

      const modelChoice = await selectMenu(
        `${title} · ${provider.name}`,
        modelActions,
        visibleModels.length ? 1 : 0,
        `${matchedModels.length} models · Page ${modelPage + 1}/${modelPages}`,
        query ? `Search: ${query}` : (currentValue ? `Selected: ${currentValue}` : ""),
      );
      if (modelChoice < 0 || modelActions[modelChoice]?.type === "back") break;
      const modelAction = modelActions[modelChoice];
      if (modelAction.type === "model") return modelAction.model;
      if (modelAction.type === "previous") modelPage--;
      if (modelAction.type === "next") modelPage++;
      if (modelAction.type === "search") {
        query = (await prompt("Search models (blank to show all): ")).trim();
        modelPage = 0;
      }
    }
  }
}

/**
 * Display model list and prompt for selection with provider grouping & search
 * @param {string} title - Title to display
 * @param {string} currentValue - Current selected value (optional)
 * @param {Object} options - { excludeCombos?: boolean, providerFirst?: boolean, catalog?: Object }
 * @returns {Promise<string|null>} Selected model ID or null if cancelled
 */
async function selectModelFromList(title, currentValue = "", options = {}) {
  const { excludeCombos = false, providerFirst = false, catalog } = options;
  const { combos: rawCombos, groups } = catalog || await getAvailableModelsGrouped();
  const combos = excludeCombos ? [] : rawCombos;

  const totalModels = combos.length + Object.values(groups).flat().length;
  if (totalModels === 0) {
    return null;
  }

  // All models for flat search
  const allModelsList = [
    ...combos,
    ...Object.values(groups).flat()
  ];

  // Build category list
  const categories = [];
  if (combos.length > 0) {
    categories.push({
      id: "combos",
      name: "[Combos]",
      models: combos
    });
  }

  const sortedProviders = Object.keys(groups).sort((a, b) => {
    const idxA = PROVIDER_ALIAS_ORDER.indexOf(a);
    const idxB = PROVIDER_ALIAS_ORDER.indexOf(b);
    return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
  });

  sortedProviders.forEach((provider) => {
    const providerName = PROVIDER_ALIAS_NAMES[provider] || provider;
    categories.push({
      id: provider,
      name: providerName,
      models: groups[provider]
    });
  });

  if (providerFirst) return selectModelByProvider(title, currentValue, categories);

  let filterQuery = null;

  while (true) {
    clearScreen();
    console.log(`\n🎯 ${title}`);
    console.log("=".repeat(50));
    if (currentValue) {
      console.log(`Current: ${currentValue}\n`);
    } else {
      console.log();
    }

    // Active search view
    if (filterQuery !== null) {
      const q = filterQuery.toLowerCase().trim();
      const matched = allModelsList.filter((m) => m.toLowerCase().includes(q));

      console.log(`🔍 Search results for "${filterQuery}": (${matched.length} found)\n`);
      if (matched.length === 0) {
        console.log("  No matching models found.\n");
        console.log("  0. ← Back to providers");
        console.log("  s. Search again\n");
        const act = await prompt("Select option: ");
        if (act.toLowerCase() === "s") {
          const newQ = await prompt("Enter search keyword: ");
          filterQuery = newQ.trim() || null;
        } else {
          filterQuery = null;
        }
        continue;
      }

      matched.forEach((m, i) => {
        console.log(`  ${i + 1}. ${m}`);
      });
      console.log("\n  0. ← Back to providers");
      console.log("  s. Search again\n");

      const input = await prompt("Enter number to select (or 0/s): ");
      if (input.toLowerCase() === "s") {
        const newQ = await prompt("Enter search keyword: ");
        filterQuery = newQ.trim() || null;
        continue;
      }
      const num = parseInt(input, 10);
      if (isNaN(num) || num === 0) {
        filterQuery = null;
        continue;
      }
      if (num > 0 && num <= matched.length) {
        return matched[num - 1];
      }
      continue;
    }

    // If only 1 category exists, jump straight into its model list
    if (categories.length === 1) {
      const singleCategory = categories[0];
      console.log(`[${singleCategory.name}]`);
      singleCategory.models.forEach((m, i) => {
        console.log(`  ${i + 1}. ${m}`);
      });
      console.log();
      console.log("  s. 🔍 Search models");
      console.log("  m. ✍️  Enter custom model ID");
      console.log("  0. Cancel\n");

      const input = await prompt("Enter choice (number / s / m / 0): ");
      const trimmed = input.trim();
      if (!trimmed || trimmed === "0") return null;

      const lower = trimmed.toLowerCase();
      if (lower === "s") {
        const q = await prompt("Enter search keyword: ");
        if (q.trim()) filterQuery = q.trim();
        continue;
      }
      if (lower === "m") {
        const customModel = await prompt("Enter custom model ID: ");
        if (customModel.trim()) return customModel.trim();
        continue;
      }

      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num > 0 && num <= singleCategory.models.length) {
        return singleCategory.models[num - 1];
      }
      filterQuery = trimmed;
      continue;
    }

    // Multiple categories view
    console.log("[Providers & Groups]");
    categories.forEach((cat, i) => {
      console.log(`  ${i + 1}. ${cat.name} (${cat.models.length} models)`);
    });

    console.log();
    console.log("  s. 🔍 Search models");
    console.log("  m. ✍️  Enter custom model ID");
    console.log("  0. Cancel\n");

    const input = await prompt("Enter choice (number / keyword / s / m): ");
    const trimmed = input.trim();

    if (!trimmed || trimmed === "0") {
      return null;
    }

    const lower = trimmed.toLowerCase();
    if (lower === "s") {
      const q = await prompt("Enter search keyword: ");
      if (q.trim()) {
        filterQuery = q.trim();
      }
      continue;
    }

    if (lower === "m") {
      const customModel = await prompt("Enter custom model ID: ");
      if (customModel.trim()) {
        return customModel.trim();
      }
      continue;
    }

    const num = parseInt(trimmed, 10);
    // Selected a category
    if (!isNaN(num) && num > 0 && num <= categories.length) {
      const selectedCategory = categories[num - 1];
      const pageSize = 20;
      let page = 0;
      let providerQuery = "";

      while (true) {
        clearScreen();
        console.log(`\n🎯 ${title} > ${selectedCategory.name}`);
        console.log("=".repeat(50));
        if (currentValue) {
          console.log(`Current: ${currentValue}\n`);
        } else {
          console.log();
        }

        const matchingModels = selectedCategory.models.filter((model) =>
          model.toLowerCase().includes(providerQuery.toLowerCase())
        );
        const pageCount = Math.max(1, Math.ceil(matchingModels.length / pageSize));
        page = Math.min(page, pageCount - 1);
        const pageModels = matchingModels.slice(page * pageSize, (page + 1) * pageSize);
        console.log(`Models: ${matchingModels.length} · Page ${page + 1}/${pageCount}`);
        if (providerQuery) console.log(`Filter: ${providerQuery}`);
        if (pageModels.length === 0) console.log("  No matching models found.");
        pageModels.forEach((m, i) => {
          console.log(`  ${i + 1}. ${m}`);
        });
        console.log("\n  n. Next page  p. Previous page  s. Search this provider");
        console.log("  0. ← Back to providers\n");

        const modelChoice = (await prompt("Enter number, n/p/s, or 0: ")).trim().toLowerCase();
        if (modelChoice === "0") break;
        if (modelChoice === "n") { page = Math.min(page + 1, pageCount - 1); continue; }
        if (modelChoice === "p") { page = Math.max(page - 1, 0); continue; }
        if (modelChoice === "s") {
          providerQuery = (await prompt("Search models (blank to show all): ")).trim();
          page = 0;
          continue;
        }
        if (!/^\d+$/.test(modelChoice)) continue;
        const modelNum = Number(modelChoice);
        if (modelNum > 0 && modelNum <= pageModels.length) return pageModels[modelNum - 1];
      }
      continue;
    }

    // User typed text directly -> treat as search query in the general picker.
    filterQuery = trimmed;
  }
}

module.exports = {
  selectModelFromList,
  getAvailableModelsGrouped,
  PROVIDER_ALIAS_ORDER,
  PROVIDER_ALIAS_NAMES
};
