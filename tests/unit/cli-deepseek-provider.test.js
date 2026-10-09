import { describe, it, expect } from "vitest";
import { APIKEY_PROVIDERS, ALL_PROVIDERS, PROVIDER_MODELS } from "../../cli/src/cli/menus/providers.js";

describe("Terminal UI DeepSeek provider integration", () => {
  it("includes deepseek in APIKEY_PROVIDERS with proper configuration", () => {
    expect(APIKEY_PROVIDERS.deepseek).toBeDefined();
    expect(APIKEY_PROVIDERS.deepseek.id).toBe("deepseek");
    expect(APIKEY_PROVIDERS.deepseek.name).toBe("DeepSeek");
    expect(APIKEY_PROVIDERS.deepseek.alias).toBe("ds");
  });

  it("registers deepseek and ds in ALL_PROVIDERS", () => {
    expect(ALL_PROVIDERS.deepseek).toBeDefined();
    expect(ALL_PROVIDERS.ds).toBeDefined();
    expect(ALL_PROVIDERS.deepseek.id).toBe("deepseek");
    expect(ALL_PROVIDERS.ds.id).toBe("deepseek");
  });

  it("configures models for deepseek and ds alias in PROVIDER_MODELS", () => {
    expect(Array.isArray(PROVIDER_MODELS.deepseek)).toBe(true);
    expect(Array.isArray(PROVIDER_MODELS.ds)).toBe(true);
    expect(PROVIDER_MODELS.ds).toEqual(PROVIDER_MODELS.deepseek);

    const modelIds = PROVIDER_MODELS.deepseek.map((m) => m.id);
    expect(modelIds).toContain("deepseek-chat");
    expect(modelIds).toContain("deepseek-reasoner");
  });

  it("includes deepseek in modelSelector configuration", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.resolve("cli/src/cli/utils/modelSelector.js"), "utf8");

    expect(content).toContain('"deepseek"');
    expect(content).toContain('"ds"');
    expect(content).toContain('deepseek: "DeepSeek"');
  });

  it("includes deepseek in scripts/telegram-bot.mjs TERMINAL_PROVIDERS", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.resolve("scripts/telegram-bot.mjs"), "utf8");

    expect(content).toContain('{ id: "deepseek", name: "DeepSeek", authType: "apikey", credentialLabel: "API key" }');
  });
});
