import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { cleanupProviderConnections, getSettings, updateSettings, getApiKeys } from "@/lib/localDb";
import { getMitmStatus, startMitm, loadEncryptedPassword, initDbHooks, restoreToolDNS, removeAllDNSEntriesSync } from "@/mitm/manager";
import { syncToJson as syncMitmAliasCache } from "@/lib/mitmAliasCache";
import { killAllBridges } from "@/lib/mcp/stdioSseBridge";

(function bootstrapMitm() {
  if (!process.env.MITM_SERVER_PATH) {
    try {
      const thisFile = fileURLToPath(import.meta.url);
      const appSrc = dirname(dirname(thisFile));
      const candidate = join(appSrc, "mitm", "server.js");
      if (existsSync(candidate)) process.env.MITM_SERVER_PATH = candidate;
    } catch { /* ignore */ }
  }
  try { initDbHooks(getSettings, updateSettings); } catch { /* ignore */ }
})();

process.setMaxListeners(20);

const STARTUP_DEFER_MS = 3000;
const state = global.__appSingleton ??= {
  signalHandlersRegistered: false,
  mitmStartInProgress: false,
};

export async function initializeApp() {
  try {
    if (!state.signalHandlersRegistered) {
      const cleanup = () => {
        try { removeAllDNSEntriesSync(); } catch { /* best effort */ }
        try { killAllBridges(); } catch { /* best effort */ }
        process.exit();
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
      process.on("exit", () => { try { removeAllDNSEntriesSync(); } catch { /* ignore */ } });
      state.signalHandlersRegistered = true;
    }

    setTimeout(() => {
      runHeavyStartup().catch((error) => console.error("[InitApp] deferred startup failed:", error.message));
    }, STARTUP_DEFER_MS);
  } catch (error) {
    console.error("[InitApp] Error:", error);
  }
}

async function runHeavyStartup() {
  await cleanupProviderConnections();
  const settings = await getSettings();

  if (settings.mitmEnabled) {
    syncMitmAliasCache().catch(() => {});
    autoStartMitm(settings);
  }

  if (hasQuotaAutoPingEnabled(settings)) {
    import("@/shared/services/quotaAutoPing")
      .then(({ startQuotaAutoPing }) => startQuotaAutoPing())
      .catch((error) => console.log("[AutoPing] scheduler start failed:", error.message));
  }

  import("@/sse/services/backgroundTokenRefresh.js")
    .then(({ startBackgroundTokenRefresh }) => startBackgroundTokenRefresh())
    .catch((error) => console.log("[BackgroundTokenRefresh] scheduler start failed:", error.message));
}

function hasQuotaAutoPingEnabled(settings) {
  return [settings?.claudeAutoPing, settings?.codexAutoPing]
    .some((config) => Object.values(config?.connections || {}).some(Boolean));
}

async function autoStartMitm(settings) {
  if (state.mitmStartInProgress) return;
  state.mitmStartInProgress = true;
  try {
    if (!settings.mitmEnabled) return;
    const mitmStatus = await getMitmStatus();
    if (mitmStatus.running) return;

    const password = await loadEncryptedPassword();
    if (!password && process.platform !== "win32") {
      console.log("[InitApp] MITM was enabled but no saved password found, skipping auto-start");
      return;
    }

    const keys = await getApiKeys();
    const activeKey = keys.find((key) => key.isActive !== false);
    await startMitm(activeKey?.key || "sk_apirouter", password);
    try { await restoreToolDNS(password); } catch (error) {
      console.log("[InitApp] DNS restore failed:", error.message);
    }
  } catch (error) {
    console.log("[InitApp] MITM auto-start failed:", error.message);
  } finally {
    state.mitmStartInProgress = false;
  }
}

export default initializeApp;
