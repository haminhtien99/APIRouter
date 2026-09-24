import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { parseArgs, parseCodexConfig, readCodexConfig, resolveEndpoint, buildStatus, renderStatus, quotaBar } = require("../../cli/src/cli/commands/statusApi");

test("status-api parses supported aliases and periods", () => {
  assert.deepEqual(parseArgs(["--host", "localhost", "--port", "8080", "--period", "today", "--json"]), {
    host: "localhost",
    port: 8080,
    protocol: "http:",
    period: "today",
    quota: true,
    quotaProvider: null,
    forceQuota: false,
    activeOnly: true,
    quotaLimit: 20,
    json: true,
    help: false,
  });
  assert.throws(() => parseArgs(["--period", "year"]), /Invalid period/);
});

test("status-api reads only the APIRouter Codex config section", () => {
  const config = parseCodexConfig(`
model = "coding-combo"
model_provider = "apirouter"

[model_providers.apirouter]
name = "APIRouter"
base_url = "http://127.0.0.1:20228/v1"
wire_api = "responses"

[projects."/tmp"]
trust_level = "trusted"
`);
  assert.deepEqual(config, {
    model: "coding-combo",
    modelProvider: "apirouter",
    baseUrl: "http://127.0.0.1:20228/v1",
  });
});

test("status-api follows the endpoint configured for Codex", () => {
  assert.deepEqual(
    resolveEndpoint(
      { host: "127.0.0.1", port: 20228, protocol: "http:" },
      { baseUrl: "http://localhost:8090/v1" },
    ),
    { host: "localhost", port: 8090, protocol: "http:" },
  );
});

test("status-api prefers the APIRouter profile over the official base config", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-profile-"));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  try {
    fs.writeFileSync(path.join(codexHome, "config.toml"), `
model = "gpt-6-sol"
model_provider = "openai"
`);
    fs.writeFileSync(path.join(codexHome, "apirouter.config.toml"), `
model = "cx/gpt-6-sol"
model_provider = "apirouter"

[model_providers.apirouter]
base_url = "http://127.0.0.1:20228/v1"
`);
    assert.deepEqual(readCodexConfig(), {
      model: "cx/gpt-6-sol",
      modelProvider: "apirouter",
      baseUrl: "http://127.0.0.1:20228/v1",
    });
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test("status-api resolves the selected model as a combo", () => {
  const status = buildStatus({
    codex: { model: "coding-combo", modelProvider: "apirouter", baseUrl: "http://localhost:20228/v1" },
    providers: { connections: [{ isActive: true }, { isActive: false }, { isActive: true, testStatus: "failed" }] },
    combos: { combos: [{ name: "coding-combo", models: ["cx/gpt-5", "cc/claude"] }] },
    usage: {
      totalRequests: 12,
      totalPromptTokens: 100,
      totalCompletionTokens: 50,
      totalCachedTokens: 10,
      totalCost: 0.12,
      byProvider: { codex: { requests: 12, promptTokens: 100, completionTokens: 50 } },
    },
    quota: {
      accounts: [{
        connection: { provider: "codex", name: "Main" },
        plan: "plus",
        quotas: [
          { name: "Session (5h)", used: 28, total: 100, remainingPercentage: 72 },
          { name: "Weekly", used: 60, total: 100, remainingPercentage: 40 },
        ],
      }],
    },
    period: "7d",
    endpoint: "http://127.0.0.1:20228",
  });
  assert.equal(status.route.type, "combo");
  assert.equal(status.providers.active, 2);
  assert.match(renderStatus(status), /Combo chain:/);
  assert.match(renderStatus(status), /cx\/gpt-5/);
  assert.match(renderStatus(status), /Quota limits/);
  assert.match(renderStatus(status), /72% left/);
});

test("quota bar clamps percentages", () => {
  assert.equal(quotaBar(50), "[█████░░░░░]");
  assert.equal(quotaBar(120), "[██████████]");
  assert.equal(quotaBar(-5), "[░░░░░░░░░░]");
});
