import { describe, expect, it } from "vitest";
import {
  buildAPIRouterProfile,
  hasAPIRouterConfig,
  migrateBaseConfigToOfficial,
  officialModelFor,
} from "../../src/lib/codexProfileConfig.js";

const catalogPath = "/home/test/.codex/apirouter-models.json";

describe("Codex APIRouter profile config", () => {
  it("moves a legacy APIRouter base config back to the official provider", () => {
    const base = {
      model: "cx/gpt-6-sol",
      model_provider: "apirouter",
      model_catalog_json: catalogPath,
      approvals_reviewer: "user",
      model_providers: {
        apirouter: { base_url: "http://127.0.0.1:20228/v1" },
      },
      agents: { default_subagent_model: "my_combo" },
    };

    expect(migrateBaseConfigToOfficial(base, { catalogPath })).toEqual({
      model: "gpt-6-sol",
      model_provider: "openai",
      approvals_reviewer: "user",
      agents: { default_subagent_model: "gpt-6-sol" },
    });
  });

  it("preserves unrelated official settings while removing a stale router section", () => {
    const base = {
      model: "gpt-6-sol",
      model_provider: "openai",
      projects: { "/work": { trust_level: "trusted" } },
      model_providers: { apirouter: { base_url: "http://localhost/v1" } },
    };

    expect(migrateBaseConfigToOfficial(base, { catalogPath })).toEqual({
      model: "gpt-6-sol",
      model_provider: "openai",
      projects: { "/work": { trust_level: "trusted" } },
    });
  });

  it("builds an isolated APIRouter profile", () => {
    const profile = buildAPIRouterProfile({}, {
      baseUrl: "http://127.0.0.1:20228/v1",
      apiKey: "secret",
      model: "cx/gpt-6-sol",
      subagentModel: "my_combo",
      catalogPath,
    });

    expect(profile).toMatchObject({
      model: "cx/gpt-6-sol",
      model_provider: "apirouter",
      model_catalog_json: catalogPath,
      agents: { default_subagent_model: "my_combo" },
      model_providers: {
        apirouter: {
          base_url: "http://127.0.0.1:20228/v1",
          wire_api: "responses",
          http_headers: { Authorization: "Bearer secret" },
        },
      },
    });
    expect(hasAPIRouterConfig(profile, catalogPath)).toBe(true);
  });

  it("uses an official equivalent only for direct Codex models", () => {
    expect(officialModelFor("cx/gpt-6-sol")).toBe("gpt-6-sol");
    expect(officialModelFor("my_combo")).toBe("gpt-6-sol");
  });
});
