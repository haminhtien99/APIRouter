import fs from "fs/promises";
import os from "os";
import path from "path";

const DEFAULT_REASONING_LEVELS = [
  { effort: "low", description: "Fast responses with lighter reasoning" },
  { effort: "medium", description: "Balanced speed and reasoning" },
  { effort: "high", description: "Greater reasoning depth for complex tasks" },
  { effort: "xhigh", description: "Extra reasoning depth for difficult tasks" },
];

const TEMPLATE_FIELDS = [
  "base_instructions",
  "default_reasoning_level",
  "supported_reasoning_levels",
  "shell_type",
  "additional_speed_tiers",
  "service_tiers",
  "default_reasoning_summary",
  "support_verbosity",
  "default_verbosity",
  "apply_patch_tool_type",
  "web_search_tool_type",
  "truncation_policy",
  "supports_image_detail_original",
  "context_window",
  "max_context_window",
  "effective_context_window_percent",
  "experimental_supported_tools",
  "input_modalities",
];

export function getCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export function getCodexModelCatalogPath() {
  return path.join(getCodexHome(), "apirouter-models.json");
}

function displayName(modelId) {
  return String(modelId)
    .split("/")
    .map((part) => part.replace(/[-_]+/g, " "))
    .map((part) => part.replace(/\b\w/g, (character) => character.toUpperCase()))
    .join(" / ");
}

function buildDescription(model) {
  if (model.owned_by === "combo") return "APIRouter combo";
  return `APIRouter model via ${model.owned_by || "local provider"}`;
}

function fallbackPreset() {
  return {
    base_instructions: "You are Codex, a coding agent. Follow the user's instructions, inspect and modify files safely, explain material changes clearly, and verify your work when practical.",
    default_reasoning_level: "medium",
    supported_reasoning_levels: DEFAULT_REASONING_LEVELS,
    shell_type: "unified_exec",
    visibility: "list",
    supported_in_api: true,
    additional_speed_tiers: [],
    service_tiers: [],
    upgrade: null,
    default_reasoning_summary: "auto",
    support_verbosity: true,
    default_verbosity: "medium",
    apply_patch_tool_type: "freeform",
    truncation_policy: { mode: "tokens", limit: 10000 },
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: ["text", "image"],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compatibleTemplate(template) {
  if (!template) return fallbackPreset();
  const compatible = {};
  for (const field of TEMPLATE_FIELDS) {
    if (template[field] !== undefined) compatible[field] = clone(template[field]);
  }
  if (!compatible.base_instructions && template.model_messages?.instructions_template) {
    compatible.base_instructions = template.model_messages.instructions_template;
  }
  return { ...fallbackPreset(), ...compatible };
}

export function buildCodexModelCatalog(models, { template = null } = {}) {
  const uniqueModels = [];
  const seen = new Set();

  for (const model of models || []) {
    const modelId = typeof model?.id === "string" ? model.id.trim() : "";
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    uniqueModels.push({ ...model, id: modelId });
  }

  if (uniqueModels.length === 0) {
    throw new Error("No APIRouter models or combos are available for Codex");
  }

  const basePreset = compatibleTemplate(template);
  const entries = uniqueModels.map((model, priority) => {
    const entry = {
      ...clone(basePreset),
      slug: model.id,
      display_name: displayName(model.id),
      description: buildDescription(model),
      visibility: "list",
      supported_in_api: true,
      priority,
      upgrade: null,
    };

    if (Number.isFinite(model.context_length)) {
      entry.context_window = model.context_length;
      entry.max_context_window = model.context_length;
    }

    return entry;
  });

  return { models: entries };
}

async function readCodexTemplate(preferredModel) {
  try {
    const cachePath = path.join(getCodexHome(), "models_cache.json");
    const cache = JSON.parse(await fs.readFile(cachePath, "utf8"));
    const models = Array.isArray(cache?.models) ? cache.models : [];
    return models.find((model) => model.slug === preferredModel) || models[0] || null;
  } catch {
    return null;
  }
}

export async function writeCodexModelCatalog(models, { preferredModel } = {}) {
  const catalogPath = getCodexModelCatalogPath();
  const template = await readCodexTemplate(preferredModel);
  const catalog = buildCodexModelCatalog(models, { template });
  const temporaryPath = `${catalogPath}.tmp`;

  await fs.mkdir(path.dirname(catalogPath), { recursive: true });
  await fs.writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, catalogPath);

  const stat = await fs.stat(catalogPath);
  return {
    path: catalogPath,
    modelCount: catalog.models.length,
    syncedAt: stat.mtime.toISOString(),
  };
}

export async function getCodexModelCatalogStatus() {
  const catalogPath = getCodexModelCatalogPath();
  try {
    const [content, stat] = await Promise.all([
      fs.readFile(catalogPath, "utf8"),
      fs.stat(catalogPath),
    ]);
    const catalog = JSON.parse(content);
    return {
      path: catalogPath,
      exists: true,
      modelCount: Array.isArray(catalog?.models) ? catalog.models.length : 0,
      syncedAt: stat.mtime.toISOString(),
    };
  } catch {
    return { path: catalogPath, exists: false, modelCount: 0, syncedAt: null };
  }
}

export async function removeCodexModelCatalog() {
  await fs.rm(getCodexModelCatalogPath(), { force: true });
}
