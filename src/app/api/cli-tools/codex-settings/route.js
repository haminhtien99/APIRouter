"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { parseTOML, stringifyTOML } from "confbox";
import { buildModelsList } from "@/app/api/v1/models/route";
import {
  getCodexHome,
  getCodexModelCatalogPath,
  getCodexModelCatalogStatus,
  removeCodexModelCatalog,
  writeCodexModelCatalog,
} from "@/lib/codexModelCatalog";

const execAsync = promisify(exec);

const getCodexDir = () => getCodexHome();
const getCodexConfigPath = () => path.join(getCodexDir(), "config.toml");
const getCodexAuthPath = () => path.join(getCodexDir(), "auth.json");
const getAPIRouterStatusSkillDir = () => path.join(getCodexDir(), "skills", "apirouter-status");
const getAPIRouterStatusSkillPath = () => path.join(getAPIRouterStatusSkillDir(), "SKILL.md");

const APIROUTER_STATUS_SKILL = `---
name: apirouter-status
description: Show local APIRouter status for Codex, including the configured model or combo route, provider availability, and usage totals.
---

# APIRouter Status

Run the first available read-only command and present its output:

\`\`\`bash
if command -v apirouter >/dev/null 2>&1; then
  apirouter status-api
elif [ -x ./apirouter ]; then
  ./apirouter status-api
else
  node cli/cli.js status-api
fi
\`\`\`

Use \`--period today\`, \`24h\`, \`7d\`, \`30d\`, \`60d\`, or \`all\` only when requested. Do not substitute Codex's built-in account status for this APIRouter-specific status.
`;

async function installAPIRouterStatusSkill() {
  await fs.mkdir(getAPIRouterStatusSkillDir(), { recursive: true });
  await fs.writeFile(getAPIRouterStatusSkillPath(), APIROUTER_STATUS_SKILL);
}

async function syncNativeModelCatalog(preferredModel) {
  const models = await buildModelsList(["llm"]);
  return writeCodexModelCatalog(models, { preferredModel });
}

// Flatten confbox-parsed TOML into a writable object, preserving nested tables
const parsedToWritable = (obj) => obj ?? {};

// Set a nested key from a flat dotted path, creating intermediate objects as needed
const setNestedSection = (obj, dottedKey, value) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== "object") {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
};

// Delete a nested key from a flat dotted path
const deleteNestedSection = (obj, dottedKey) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur = cur?.[keys[i]];
    if (cur == null) return;
  }
  delete cur[keys[keys.length - 1]];
};

// Check if codex CLI is installed (via which/where or config file exists)
const checkCodexInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where codex" : "which codex";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getCodexConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

// Read current config.toml
const readConfig = async () => {
  try {
    const configPath = getCodexConfigPath();
    const content = await fs.readFile(configPath, "utf-8");
    return content;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

// Check if config has APIRouter settings
const hasAPIRouterConfig = (config) => {
  if (!config) return false;
  return config.includes("model_provider = \"apirouter\"") || config.includes("[model_providers.apirouter]");
};

// GET - Check codex CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkCodexInstalled();
    
    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Codex CLI is not installed",
      });
    }

    const [config, modelCatalog] = await Promise.all([
      readConfig(),
      getCodexModelCatalogStatus(),
    ]);

    return NextResponse.json({
      installed: true,
      config,
      hasAPIRouter: hasAPIRouterConfig(config),
      configPath: getCodexConfigPath(),
      statusSkillPath: getAPIRouterStatusSkillPath(),
      modelCatalog,
    });
  } catch (error) {
    console.log("Error checking codex settings:", error);
    return NextResponse.json({ error: "Failed to check codex settings" }, { status: 500 });
  }
}

// POST - Update APIRouter settings (merge with existing config)
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, subagentModel } = await request.json();
    
    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }

    const codexDir = getCodexDir();
    const configPath = getCodexConfigPath();

    // Ensure directory exists
    await fs.mkdir(codexDir, { recursive: true });

    // Read and parse existing config
    let parsed = {};
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      parsed = parsedToWritable(parseTOML(existingConfig));
    } catch { /* No existing config */ }

    // Update only APIRouter related fields (api_key goes to auth.json, not config.toml)
    parsed.model = model;
    parsed.model_provider = "apirouter";
    const modelCatalog = await syncNativeModelCatalog(model);
    parsed.model_catalog_json = modelCatalog.path;

    // Update or create apirouter provider section (no api_key - Codex reads from auth.json)
    // Ensure /v1 suffix is added only once
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    // Custom providers ignore auth.json - the key must travel as a static header
    setNestedSection(parsed, "model_providers.apirouter", {
      name: "APIRouter",
      base_url: normalizedBaseUrl,
      wire_api: "responses",
      http_headers: { Authorization: `Bearer ${apiKey}` },
    });

    // Subagent model is a scalar under [agents]; agents.<role> now means a custom role
    deleteNestedSection(parsed, "agents.subagent");
    setNestedSection(parsed, "agents.default_subagent_model", subagentModel || model);

    // Write merged config
    const configContent = stringifyTOML(parsed);
    await fs.writeFile(configPath, configContent);
    await installAPIRouterStatusSkill();

    return NextResponse.json({
      success: true,
      message: "Codex settings applied successfully!",
      configPath,
      statusSkillPath: getAPIRouterStatusSkillPath(),
      modelCatalog,
    });
  } catch (error) {
    console.log("Error updating codex settings:", error);
    return NextResponse.json({ error: "Failed to update codex settings" }, { status: 500 });
  }
}

// PUT - Refresh native /model catalog without changing provider credentials
export async function PUT() {
  try {
    const configPath = getCodexConfigPath();
    let parsed = {};
    try {
      parsed = parsedToWritable(parseTOML(await fs.readFile(configPath, "utf-8")));
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({ error: "Configure Codex with APIRouter first" }, { status: 400 });
      }
      throw error;
    }

    if (parsed.model_provider !== "apirouter") {
      return NextResponse.json({ error: "Codex is not configured to use APIRouter" }, { status: 400 });
    }

    const modelCatalog = await syncNativeModelCatalog(parsed.model);
    parsed.model_catalog_json = modelCatalog.path;
    await fs.writeFile(configPath, stringifyTOML(parsed));

    return NextResponse.json({
      success: true,
      message: `Synced ${modelCatalog.modelCount} models and combos for native /model`,
      modelCatalog,
    });
  } catch (error) {
    console.log("Error syncing Codex model catalog:", error);
    return NextResponse.json({ error: error.message || "Failed to sync Codex model catalog" }, { status: 500 });
  }
}

// DELETE - Remove APIRouter settings only (keep other settings)
export async function DELETE() {
  try {
    const configPath = getCodexConfigPath();

    // Read and parse existing config
    let parsed = {};
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      parsed = parsedToWritable(parseTOML(existingConfig));
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No config file to reset",
        });
      }
      throw error;
    }

    // Remove APIRouter related root fields only if they point to apirouter
    if (parsed.model_provider === "apirouter") {
      delete parsed.model;
      delete parsed.model_provider;
    }

    // Remove apirouter provider section
    deleteNestedSection(parsed, "model_providers.apirouter");

    if (parsed.model_catalog_json === getCodexModelCatalogPath()) {
      delete parsed.model_catalog_json;
    }

    // Remove subagent configuration (both the current key and the legacy role form)
    deleteNestedSection(parsed, "agents.default_subagent_model");
    deleteNestedSection(parsed, "agents.subagent");

    // Write updated config
    const configContent = stringifyTOML(parsed);
    await fs.writeFile(configPath, configContent);

    try {
      await fs.rm(getAPIRouterStatusSkillDir(), { recursive: true, force: true });
    } catch { /* Skill was not installed */ }

    await removeCodexModelCatalog();

    // Remove OPENAI_API_KEY from auth.json
    const authPath = getCodexAuthPath();
    try {
      const existingAuth = await fs.readFile(authPath, "utf-8");
      const authData = JSON.parse(existingAuth);
      delete authData.OPENAI_API_KEY;
      delete authData.auth_mode;

      // Write back or delete if empty
      if (Object.keys(authData).length === 0) {
        await fs.unlink(authPath);
      } else {
        await fs.writeFile(authPath, JSON.stringify(authData, null, 2));
      }
    } catch { /* No auth file */ }

    return NextResponse.json({
      success: true,
      message: "APIRouter settings removed successfully",
    });
  } catch (error) {
    console.log("Error resetting codex settings:", error);
    return NextResponse.json({ error: "Failed to reset codex settings" }, { status: 500 });
  }
}
