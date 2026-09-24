"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { parseTOML, stringifyTOML } from "confbox";
import { buildModelsList } from "@/app/api/v1/models/route";
import {
  buildAPIRouterProfile,
  CODEX_APIROUTER_PROFILE_NAME,
  hasAPIRouterConfig,
  migrateBaseConfigToOfficial,
} from "@/lib/codexProfileConfig";
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
const getAPIRouterProfilePath = () => path.join(getCodexDir(), `${CODEX_APIROUTER_PROFILE_NAME}.config.toml`);
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

async function readTextFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readTomlFile(filePath) {
  const content = await readTextFile(filePath);
  return {
    content,
    parsed: content ? parsedToWritable(parseTOML(content)) : {},
  };
}

async function writeTomlFile(filePath, parsed) {
  const temporaryPath = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporaryPath, stringifyTOML(parsed), { mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

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
      await Promise.any([
        fs.access(getCodexConfigPath()),
        fs.access(getAPIRouterProfilePath()),
      ]);
      return true;
    } catch {
      return false;
    }
  }
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

    const [base, profile, modelCatalog] = await Promise.all([
      readTomlFile(getCodexConfigPath()),
      readTomlFile(getAPIRouterProfilePath()),
      getCodexModelCatalogStatus(),
    ]);
    const hasProfile = hasAPIRouterConfig(profile.parsed, getCodexModelCatalogPath());
    const hasLegacyConfig = hasAPIRouterConfig(base.parsed, getCodexModelCatalogPath());
    const config = hasProfile ? profile.content : hasLegacyConfig ? base.content : null;

    return NextResponse.json({
      installed: true,
      config,
      baseConfig: base.content,
      profileConfig: profile.content,
      hasAPIRouter: hasProfile || hasLegacyConfig,
      usesProfile: hasProfile,
      configPath: getCodexConfigPath(),
      profilePath: getAPIRouterProfilePath(),
      launchCommand: `codex -p ${CODEX_APIROUTER_PROFILE_NAME}`,
      statusSkillPath: getAPIRouterStatusSkillPath(),
      modelCatalog,
    });
  } catch (error) {
    console.log("Error checking codex settings:", error);
    return NextResponse.json({ error: "Failed to check codex settings" }, { status: 500 });
  }
}

// POST - Store APIRouter in an isolated Codex profile and keep base config official.
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, subagentModel } = await request.json();
    
    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }

    const codexDir = getCodexDir();
    const configPath = getCodexConfigPath();
    const profilePath = getAPIRouterProfilePath();

    // Ensure directory exists
    await fs.mkdir(codexDir, { recursive: true });

    const modelCatalog = await syncNativeModelCatalog(model);
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const [base, existingProfile] = await Promise.all([
      readTomlFile(configPath),
      readTomlFile(profilePath),
    ]);
    const officialBase = migrateBaseConfigToOfficial(base.parsed, {
      catalogPath: getCodexModelCatalogPath(),
    });
    const profile = buildAPIRouterProfile(existingProfile.parsed, {
      baseUrl: normalizedBaseUrl,
      apiKey,
      model,
      subagentModel,
      catalogPath: modelCatalog.path,
    });

    await Promise.all([
      writeTomlFile(configPath, officialBase),
      writeTomlFile(profilePath, profile),
    ]);
    await installAPIRouterStatusSkill();

    return NextResponse.json({
      success: true,
      message: `APIRouter profile saved. Start Codex with: codex -p ${CODEX_APIROUTER_PROFILE_NAME}`,
      configPath,
      profilePath,
      launchCommand: `codex -p ${CODEX_APIROUTER_PROFILE_NAME}`,
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
    const profilePath = getAPIRouterProfilePath();
    const { content, parsed } = await readTomlFile(profilePath);

    if (!content || parsed.model_provider !== CODEX_APIROUTER_PROFILE_NAME) {
      return NextResponse.json({ error: "Configure the Codex APIRouter profile first" }, { status: 400 });
    }

    const modelCatalog = await syncNativeModelCatalog(parsed.model);
    parsed.model_catalog_json = modelCatalog.path;
    await writeTomlFile(profilePath, parsed);

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

// DELETE - Remove only the APIRouter profile and artifacts; preserve official auth.
export async function DELETE() {
  try {
    const configPath = getCodexConfigPath();
    const base = await readTomlFile(configPath);
    if (base.content) {
      await writeTomlFile(
        configPath,
        migrateBaseConfigToOfficial(base.parsed, {
          catalogPath: getCodexModelCatalogPath(),
        }),
      );
    }
    await fs.rm(getAPIRouterProfilePath(), { force: true });

    try {
      await fs.rm(getAPIRouterStatusSkillDir(), { recursive: true, force: true });
    } catch { /* Skill was not installed */ }

    await removeCodexModelCatalog();

    return NextResponse.json({
      success: true,
      message: "APIRouter profile removed. Official Codex config and login were preserved.",
    });
  } catch (error) {
    console.log("Error resetting codex settings:", error);
    return NextResponse.json({ error: "Failed to reset codex settings" }, { status: 500 });
  }
}
