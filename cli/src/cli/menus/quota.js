const api = require("../api/client");
const { loadQuota, renderQuota } = require("../commands/statusApi");
const { selectMenu, pause } = require("../utils/input");
const { clearScreen, showHeader, showStatus } = require("../utils/display");

async function displayQuota({ provider = null, force = false, breadcrumb = [] } = {}) {
  clearScreen();
  const scope = provider || "All active accounts";
  showHeader("Quota / Token Limits", scope);
  showStatus(force ? "Force-refreshing quota from providers..." : "Loading quota...", "info");

  const quota = await loadQuota({
    quota: true,
    quotaProvider: provider,
    forceQuota: force,
    activeOnly: true,
    quotaLimit: 20,
  });

  clearScreen();
  showHeader("Quota / Token Limits", [...breadcrumb, scope].join(" > "));
  console.log(renderQuota(quota).join("\n"));
  if (quota?.total > quota.accounts.length) {
    console.log(`\nShowing ${quota.accounts.length} of ${quota.total} accounts.`);
  }
  await pause("\nPress Enter to return to quota menu...");
}

async function showQuotaMenu(breadcrumb = []) {
  while (true) {
    const providersResult = await api.getQuotaConnections({ activeOnly: true, limit: 1 });
    if (!providersResult.success) {
      clearScreen();
      showHeader("Quota / Token Limits");
      showStatus(`Failed to load quota providers: ${providersResult.error}`, "error");
      await pause("\nPress Enter to go back...");
      return;
    }

    const providers = providersResult.data.providerOptions || [];
    const items = [
      { label: "← Back to Main Menu", action: "back" },
      { label: "All Active Accounts", provider: null, force: false },
      { label: "Force Refresh All Active Accounts", provider: null, force: true },
      ...providers.map((provider) => ({
        label: `${provider} Accounts`,
        provider,
        force: false,
      })),
    ];

    const selected = await selectMenu(
      "⏱ Quota / Token Limits",
      items.map((item) => ({ label: item.label, icon: "☆" })),
      0,
      "Same normalized quota data as the Web UI tracker",
      `Active quota accounts: ${providersResult.data.totals?.eligibleConnections || 0}`,
      breadcrumb,
    );

    if (selected <= 0 || items[selected]?.action === "back") return;
    const item = items[selected];
    await displayQuota({
      provider: item.provider,
      force: item.force,
      breadcrumb,
    });
  }
}

module.exports = { showQuotaMenu, displayQuota };
