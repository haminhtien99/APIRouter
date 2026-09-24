export const CODEX_APIROUTER_PROFILE_NAME = "apirouter";
export const DEFAULT_OFFICIAL_CODEX_MODEL = "gpt-6-sol";

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function setNestedValue(target, dottedKey, value) {
  const keys = dottedKey.split(".");
  let current = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    if (!isPlainObject(current[keys[index]])) current[keys[index]] = {};
    current = current[keys[index]];
  }
  current[keys.at(-1)] = value;
}

export function deleteNestedValue(target, dottedKey) {
  const keys = dottedKey.split(".");
  const parents = [];
  let current = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    if (!isPlainObject(current?.[keys[index]])) return;
    parents.push([current, keys[index]]);
    current = current[keys[index]];
  }
  delete current[keys.at(-1)];
  for (let index = parents.length - 1; index >= 0; index -= 1) {
    const [parent, key] = parents[index];
    if (isPlainObject(parent[key]) && Object.keys(parent[key]).length === 0) {
      delete parent[key];
    }
  }
}

export function officialModelFor(routerModel) {
  const model = typeof routerModel === "string" ? routerModel.trim() : "";
  if (/^cx\/gpt-/i.test(model)) return model.slice(3);
  return DEFAULT_OFFICIAL_CODEX_MODEL;
}

export function hasAPIRouterConfig(config, catalogPath = null) {
  if (!isPlainObject(config)) return false;
  return config.model_provider === CODEX_APIROUTER_PROFILE_NAME
    || isPlainObject(config.model_providers?.apirouter)
    || (catalogPath && config.model_catalog_json === catalogPath);
}

export function migrateBaseConfigToOfficial(config = {}, { catalogPath } = {}) {
  const base = isPlainObject(config) ? config : {};
  const selectedAPIRouter =
    base.model_provider === CODEX_APIROUTER_PROFILE_NAME
    || (/^cx\//i.test(base.model || "") && base.model_catalog_json === catalogPath);

  if (selectedAPIRouter) {
    const officialModel = officialModelFor(base.model);
    base.model = officialModel;
    base.model_provider = "openai";
    if (base.agents?.default_subagent_model) {
      setNestedValue(base, "agents.default_subagent_model", officialModel);
    }
  }

  deleteNestedValue(base, "model_providers.apirouter");
  if (!catalogPath || base.model_catalog_json === catalogPath) {
    delete base.model_catalog_json;
  }
  return base;
}

export function buildAPIRouterProfile(config = {}, {
  baseUrl,
  apiKey,
  model,
  subagentModel,
  catalogPath,
}) {
  const profile = isPlainObject(config) ? config : {};
  profile.model = model;
  profile.model_provider = CODEX_APIROUTER_PROFILE_NAME;
  profile.model_catalog_json = catalogPath;
  setNestedValue(profile, "model_providers.apirouter", {
    name: "APIRouter",
    base_url: baseUrl,
    wire_api: "responses",
    http_headers: { Authorization: `Bearer ${apiKey}` },
  });
  deleteNestedValue(profile, "agents.subagent");
  setNestedValue(profile, "agents.default_subagent_model", subagentModel || model);
  return profile;
}
