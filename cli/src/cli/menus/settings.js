const api = require("../api/client");
const { confirm, pause } = require("../utils/input");
const { showStatus } = require("../utils/display");
const { showMenuWithBack } = require("../utils/menuHelper");

const DEFAULT_PASSWORD = "123456";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

async function showSettingsMenu(breadcrumb = []) {
  await showMenuWithBack({
    title: "⚙️  Settings",
    breadcrumb,
    headerContent: (data) => {
      const rtkOn = data?.settings?.rtkEnabled !== false;
      const authMode = data?.settings?.authMode || "password";
      return [
        "  Endpoint: http://127.0.0.1:20228/v1",
        `  RTK:      ${rtkOn ? GREEN : RED}${rtkOn ? "ON" : "OFF"}${RESET}`,
        `  Auth:     ${authMode.toUpperCase()}`,
      ].join("\n");
    },
    refresh: async () => {
      const result = await api.getSettings();
      return { settings: result.success ? (result.data || {}) : {} };
    },
    items: [
      {
        label: (data) => `Token Saver (RTK): ${data?.settings?.rtkEnabled !== false ? "ON" : "OFF"} → toggle`,
        action: async (data) => { await toggleRtk(data?.settings?.rtkEnabled !== false); return true; },
      },
      {
        label: "🔑 Reset Password to Default",
        action: async () => { await resetPassword(); return true; },
      },
      {
        label: (data) => {
          const mode = data?.settings?.authMode || "password";
          return mode === "password" ? "🔓 Auth Mode: password" : `🔓 Reset Auth Mode to Password (current: ${mode})`;
        },
        action: async () => { await resetAuthMode(); return true; },
      },
    ],
  });
}

async function toggleRtk(currentlyOn) {
  const next = !currentlyOn;
  const result = await api.updateSettings({ rtkEnabled: next });
  showStatus(result.success ? `Token Saver ${next ? "enabled" : "disabled"}` : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

async function resetPassword() {
  if (!(await confirm(`Reset dashboard password to default "${DEFAULT_PASSWORD}"?`))) return;
  const result = await api.resetPassword();
  showStatus(result.success ? `Password reset. Default: ${DEFAULT_PASSWORD}` : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

async function resetAuthMode() {
  if (!(await confirm("Reset auth mode to PASSWORD?"))) return;
  const result = await api.updateSettings({ authMode: "password" });
  showStatus(result.success ? "Auth mode reset to password." : `Failed: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

module.exports = { showSettingsMenu };
