import fs from "fs/promises";
import os from "os";
import path from "path";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

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

// Preserve the current client's model-specific prompts and tool behavior only
// for its own models. Third-party models use the portable preset above.
const NATIVE_TEMPLATE_FIELDS = [
  "model_messages",
  "include_skills_usage_instructions",
  "include_plugin_usage_instructions",
  "include_apps_usage_instructions",
  "supports_search_tool",
  "supports_experimental_context",
  "supports_reasoning_effort_updates",
  "node_repl_auto_review_required",
  "node_repl_disabled",
  "tool_mode",
  "multi_agent_version",
  "multi_agent_reasoning_effort",
];

function modelIdentity(model) {
  const slash = model.id.indexOf("/");
  const alias = slash < 0 ? model.owned_by : model.id.slice(0, slash);
  const id = slash < 0 ? model.id : model.id.slice(slash + 1);
  const upstreamId = getModelUpstreamId(alias, id).replace(/\([^()]+\)\s*$/, "");
  return { provider: resolveProviderAlias(alias), id: upstreamId };
}

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

function compatibleTemplate(template, native = false) {
  if (!template) return fallbackPreset();
  const compatible = {};
  for (const field of [...TEMPLATE_FIELDS, ...(native ? NATIVE_TEMPLATE_FIELDS : [])]) {
    if (template[field] !== undefined) compatible[field] = clone(template[field]);
  }
  if (!compatible.base_instructions && template.model_messages?.instructions_template) {
    compatible.base_instructions = template.model_messages.instructions_template;
  }
  return { ...fallbackPreset(), ...compatible };
}

export function buildCodexModelCatalog(models, { template = null, templates = [] } = {}) {
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

  const entries = uniqueModels.map((model, priority) => {
    const identity = modelIdentity(model);
    const nativeTemplate = identity.provider === "codex"
      ? templates.find((candidate) => candidate.slug === identity.id)
      : null;
    const basePreset = compatibleTemplate(nativeTemplate || template, !!nativeTemplate);
    const entry = {
      ...clone(basePreset),
      slug: model.id,
      display_name: displayName(model.id),
      description: buildDescription(model),
      visibility: "list",
      supported_in_api: true,
      priority,
      upgrade: null,
      // APIRouter exposes the standard Responses endpoint, not /responses/lite.
      use_responses_lite: false,
    };

    if (Number.isFinite(model.context_length) && model.context_length > 0 && !nativeTemplate) {
      entry.context_window = model.context_length;
      entry.max_context_window = model.context_length;
    }
    if (!nativeTemplate && model.owned_by !== "combo") {
      const levels = getThinkingLevels(identity.provider, identity.id);
      if (levels) {
        entry.supported_reasoning_levels = levels.map((effort) => ({
          effort,
          description: DEFAULT_REASONING_LEVELS.find((level) => level.effort === effort)?.description || `${effort} reasoning`,
        }));
        if (!levels.includes(entry.default_reasoning_level)) {
          entry.default_reasoning_level = levels.includes("high") ? "high" : levels[0];
        }
      } else if (model.capabilities?.reasoning === false) {
        entry.supported_reasoning_levels = [];
        entry.default_reasoning_level = null;
      }
      if (typeof model.capabilities?.vision === "boolean") {
        entry.input_modalities = model.capabilities.vision ? ["text", "image"] : ["text"];
      }
    }

    return entry;
  });

  return { models: entries };
}

async function readCodexTemplates(preferredModel) {
  try {
    const cachePath = path.join(getCodexHome(), "models_cache.json");
    const cache = JSON.parse(await fs.readFile(cachePath, "utf8"));
    const models = Array.isArray(cache?.models) ? cache.models : [];
    const preferredId = modelIdentity({ id: preferredModel || "", owned_by: "cx" }).id;
    return { templates: models, template: models.find((model) => model.slug === preferredId) || models[0] || null };
  } catch {
    return { templates: [], template: null };
  }
}

export async function writeCodexModelCatalog(models, { preferredModel } = {}) {
  const catalogPath = getCodexModelCatalogPath();
  const templates = await readCodexTemplates(preferredModel);
  const catalog = buildCodexModelCatalog(models, templates);
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
