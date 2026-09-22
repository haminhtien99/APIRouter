const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath, env) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) env[key] = value;
  }
}

function createTelegramBotController({
  appDir,
  projectDir,
  launchDir,
  port,
  runtime = process.execPath,
  baseEnv = process.env,
  spawnProcess = spawn,
  showLog = false,
}) {
  let child = null;
  let enabled = false;
  let lastError = "";

  function buildEnv() {
    const env = { ...baseEnv };
    for (const directory of [launchDir, projectDir]) {
      loadEnvFile(path.join(directory, ".env.local"), env);
      loadEnvFile(path.join(directory, ".env"), env);
    }
    env.APIRouter_BASE_URL = `http://127.0.0.1:${port}`;
    return env;
  }

  function resolveScript() {
    const candidates = [
      path.join(appDir, "scripts", "telegram-bot.mjs"),
      path.join(projectDir, "scripts", "telegram-bot.mjs"),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  }

  function getStatus() {
    const env = buildEnv();
    const running = !!child && child.exitCode === null;
    return {
      configured: !!env.TELEGRAM_BOT_TOKEN,
      enabled: enabled && running,
      running,
      error: lastError,
    };
  }

  function start() {
    if (child && child.exitCode === null) {
      enabled = true;
      return { success: true, status: getStatus() };
    }

    const env = buildEnv();
    if (!env.TELEGRAM_BOT_TOKEN) {
      lastError = "TELEGRAM_BOT_TOKEN is not configured in .env.local or the environment.";
      return { success: false, error: lastError, status: getStatus() };
    }

    const scriptPath = resolveScript();
    if (!fs.existsSync(scriptPath)) {
      lastError = `Telegram bot runtime not found: ${scriptPath}`;
      return { success: false, error: lastError, status: getStatus() };
    }

    lastError = "";
    enabled = true;
    const spawnedChild = spawnProcess(runtime, [scriptPath], {
      cwd: launchDir,
      env,
      stdio: showLog ? "inherit" : ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    child = spawnedChild;

    spawnedChild.stderr?.on("data", (data) => {
      const message = String(data).trim();
      if (message) lastError = message.slice(-500);
    });
    spawnedChild.once("error", (error) => {
      lastError = error.message;
    });
    spawnedChild.once("exit", (code, signal) => {
      if (child !== spawnedChild) return;
      child = null;
      if (enabled && code !== 0) {
        lastError = `Telegram bot stopped (${signal || `exit ${code}`}).`;
      }
      enabled = false;
    });

    return { success: true, status: getStatus() };
  }

  function stop() {
    enabled = false;
    lastError = "";
    if (child && child.exitCode === null) child.kill("SIGKILL");
    child = null;
    return { success: true, status: getStatus() };
  }

  function toggle() {
    return getStatus().running ? stop() : start();
  }

  return { getStatus, start, stop, toggle };
}

module.exports = { createTelegramBotController, loadEnvFile };
