const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const api = require("../api/client");

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

function parseArgs(argv) {
  const options = {
    host: "127.0.0.1",
    port: 20228,
    protocol: "http:",
    period: "7d",
    quota: true,
    quotaProvider: null,
    forceQuota: false,
    activeOnly: true,
    quotaLimit: 20,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--host" || value === "-H") options.host = argv[++index] || options.host;
    else if (value === "--port" || value === "-p") options.port = Number.parseInt(argv[++index], 10) || options.port;
    else if (value === "--https") options.protocol = "https:";
    else if (value === "--period") options.period = argv[++index] || options.period;
    else if (value === "--no-quota") options.quota = false;
    else if (value === "--provider") options.quotaProvider = argv[++index] || null;
    else if (value === "--force") options.forceQuota = true;
    else if (value === "--all-accounts") options.activeOnly = false;
    else if (value === "--quota-limit") options.quotaLimit = Number.parseInt(argv[++index], 10) || options.quotaLimit;
    else if (value === "--json") options.json = true;
    else if (value === "--help" || value === "-h") options.help = true;
    else throw new Error(`Unknown option: ${value}`);
  }

  if (!VALID_PERIODS.has(options.period)) {
    throw new Error(`Invalid period: ${options.period}`);
  }
  return options;
}

function parseCodexConfig(content) {
  if (!content) return { model: null, modelProvider: null, baseUrl: null };
  const root = content.split(/^\s*\[/m, 1)[0];
  const sectionMatch = /^\s*\[model_providers\.apirouter\]\s*$/m.exec(content);
  const sectionTail = sectionMatch ? content.slice(sectionMatch.index + sectionMatch[0].length) : "";
  const nextSectionIndex = sectionTail.search(/^\s*\[/m);
  const providerSection = nextSectionIndex >= 0 ? sectionTail.slice(0, nextSectionIndex) : sectionTail;
  const readString = (source, key) => source.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, "m"))?.[1] || null;
  return {
    model: readString(root, "model"),
    modelProvider: readString(root, "model_provider"),
    baseUrl: readString(providerSection, "base_url"),
  };
}

function readCodexConfig() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  for (const fileName of ["apirouter.config.toml", "config.toml"]) {
    try {
      const parsed = parseCodexConfig(fs.readFileSync(path.join(codexHome, fileName), "utf8"));
      if (parsed.modelProvider === "apirouter" || fileName === "config.toml") return parsed;
    } catch {
      // Try the next config layer.
    }
  }
  return parseCodexConfig("");
}

function resolveEndpoint(options, codex) {
  if (!codex.baseUrl) return { host: options.host, port: options.port, protocol: options.protocol };
  try {
    const configured = new URL(codex.baseUrl);
    return {
      host: configured.hostname || options.host,
      port: Number.parseInt(configured.port, 10) || (configured.protocol === "https:" ? 443 : 80),
      protocol: configured.protocol === "https:" ? "https:" : "http:",
    };
  } catch {
    return { host: options.host, port: options.port, protocol: options.protocol };
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("en", {
    notation: Math.abs(Number(value) || 0) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function buildStatus({ codex, providers, combos, usage, quota = null, period, endpoint }) {
  const connections = providers.connections || [];
  const activeConnections = connections.filter((connection) => connection.isActive !== false);
  const selectedCombo = (combos.combos || []).find((combo) => combo.name === codex.model);
  const topProviders = Object.entries(usage.byProvider || {})
    .sort(([, left], [, right]) => (right.requests || 0) - (left.requests || 0))
    .slice(0, 5)
    .map(([provider, item]) => ({
      provider,
      requests: item.requests || 0,
      tokens: (item.promptTokens || 0) + (item.completionTokens || 0),
    }));

  return {
    ok: true,
    endpoint,
    codex: {
      modelProvider: codex.modelProvider,
      model: codex.model,
      configuredBaseUrl: codex.baseUrl,
    },
    route: selectedCombo
      ? { type: "combo", name: selectedCombo.name, models: selectedCombo.models || [] }
      : { type: "model", name: codex.model, models: codex.model ? [codex.model] : [] },
    providers: {
      active: activeConnections.length,
      total: connections.length,
      failed: connections.filter((connection) => connection.testStatus === "failed").length,
    },
    usage: {
      period,
      requests: usage.totalRequests || 0,
      promptTokens: usage.totalPromptTokens || 0,
      completionTokens: usage.totalCompletionTokens || 0,
      cachedTokens: usage.totalCachedTokens || 0,
      cost: usage.totalCost || 0,
      topProviders,
    },
    quota,
  };
}

function formatResetTime(value) {
  if (!value) return null;
  const resetAt = new Date(value);
  if (!Number.isFinite(resetAt.getTime())) return null;
  const diffMs = resetAt.getTime() - Date.now();
  const absolute = resetAt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (diffMs <= 0) return `reset due (${absolute})`;
  const totalMinutes = Math.ceil(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const relative = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return `resets in ${relative} (${absolute})`;
}

function quotaBar(remainingPercentage, width = 10) {
  const safe = Math.max(0, Math.min(100, Number(remainingPercentage) || 0));
  const filled = Math.round((safe / 100) * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

function renderQuota(quotaState) {
  if (!quotaState) return [];
  const lines = ["", "Quota limits", "------------"];
  if (quotaState.error) {
    lines.push(`Unable to load quota accounts: ${quotaState.error}`);
    return lines;
  }
  if (!quotaState.accounts.length) {
    lines.push("No quota-supported accounts found.");
    return lines;
  }

  for (const account of quotaState.accounts) {
    const label = account.connection
      ? `${account.connection.provider} · ${account.connection.name}`
      : `${account.provider || "provider"} · ${account.name || account.id?.slice(0, 8) || "account"}`;
    lines.push(label);
    if (account.error) {
      lines.push(`  unavailable: ${account.error}`);
      continue;
    }
    if (account.plan) lines.push(`  plan: ${account.plan}`);
    if (!account.quotas?.length) {
      lines.push(`  ${account.message || "No quota data returned."}`);
      continue;
    }
    for (const quota of account.quotas) {
      const remaining = Math.max(0, Math.min(100, Number(quota.remainingPercentage) || 0));
      const amount = quota.total
        ? ` · ${formatNumber(quota.used || 0)}/${formatNumber(quota.total)}${quota.unit ? ` ${quota.unit}` : ""}`
        : quota.unlimited ? " · unlimited" : "";
      lines.push(`  ${String(quota.name || "Quota").padEnd(18)} ${quotaBar(remaining)} ${Math.round(remaining)}% left${amount}`);
      const reset = formatResetTime(quota.resetAt);
      if (reset) lines.push(`  ${"".padEnd(18)}  ${reset}`);
      if (quota.message) lines.push(`  ${"".padEnd(18)}  ${quota.message}`);
    }
  }
  return lines;
}

function renderStatus(status) {
  const lines = [
    "APIRouter Codex Status",
    "======================",
    `Gateway:       online (${status.endpoint})`,
    `Codex provider: ${status.codex.modelProvider || "not configured"}`,
    `Codex model:    ${status.codex.model || "not configured"}`,
    `Route:          ${status.route.type}${status.route.name ? ` (${status.route.name})` : ""}`,
  ];

  if (status.route.type === "combo") {
    lines.push("Combo chain:");
    status.route.models.forEach((model, index) => lines.push(`  ${index + 1}. ${model}`));
  }

  lines.push(
    `Providers:      ${status.providers.active}/${status.providers.total} active${status.providers.failed ? `, ${status.providers.failed} failed` : ""}`,
    `Usage (${status.usage.period}): ${formatNumber(status.usage.requests)} requests, ${formatNumber(status.usage.promptTokens + status.usage.completionTokens)} tokens, $${Number(status.usage.cost).toFixed(4)}`,
  );

  if (status.usage.topProviders.length) {
    lines.push("Top providers:");
    status.usage.topProviders.forEach((item) => {
      lines.push(`  - ${item.provider}: ${formatNumber(item.requests)} requests, ${formatNumber(item.tokens)} tokens`);
    });
  }
  lines.push(...renderQuota(status.quota));
  return lines.join("\n");
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function loadQuota(options) {
  if (!options.quota) return null;
  const connectionsResult = await api.getQuotaConnections({
    provider: options.quotaProvider,
    activeOnly: options.activeOnly,
    limit: options.quotaLimit,
  });
  if (!connectionsResult.success) {
    return { accounts: [], error: connectionsResult.error };
  }
  const connections = connectionsResult.data.connections || [];
  const accounts = await mapWithConcurrency(connections, 3, async (connection) => {
    const result = await api.getConnectionQuotaSummary(connection.id, { force: options.forceQuota });
    if (!result.success) return { ...connection, error: result.error };
    return result.data;
  });
  return { accounts, total: connectionsResult.data.pagination?.total || connections.length };
}

function printHelp() {
  console.log(`
Usage: apirouter status-api [options]

Show Codex configuration, combo route, providers, and APIRouter usage.

Options:
  -H, --host <host>       APIRouter host (default: 127.0.0.1)
  -p, --port <port>       APIRouter port (default: 20228)
  --https                 Use HTTPS
  --period <period>       today, 24h, 7d, 30d, 60d, all (default: 7d)
  --provider <provider>   Show quota only for one provider, for example codex
  --force                 Force-refresh provider quota instead of using upstream cache
  --all-accounts          Include inactive quota accounts
  --quota-limit <count>   Maximum quota accounts to load (default: 20, max: 100)
  --no-quota              Skip quota API calls
  --json                  Print machine-readable JSON
  -h, --help              Show this help
`);
}

async function run(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    printHelp();
    return 1;
  }
  if (options.help) {
    printHelp();
    return 0;
  }

  const codex = readCodexConfig();
  const resolvedEndpoint = resolveEndpoint(options, codex);
  api.configure(resolvedEndpoint);
  const [providersResult, combosResult, usageResult, quota] = await Promise.all([
    api.getProviders(),
    api.getCombos(),
    api.getUsageStats(options.period),
    loadQuota(options),
  ]);
  const failed = [providersResult, combosResult, usageResult].find((result) => !result.success);
  if (failed) {
    console.error(`❌ Cannot read APIRouter status: ${failed.error}`);
    return 1;
  }

  const endpoint = `${resolvedEndpoint.protocol}//${resolvedEndpoint.host}:${resolvedEndpoint.port}`;
  const status = buildStatus({
    codex,
    providers: providersResult.data,
    combos: combosResult.data,
    usage: usageResult.data,
    quota,
    period: options.period,
    endpoint,
  });
  console.log(options.json ? JSON.stringify(status, null, 2) : renderStatus(status));
  return 0;
}

module.exports = {
  run,
  parseArgs,
  parseCodexConfig,
  readCodexConfig,
  resolveEndpoint,
  buildStatus,
  renderStatus,
  renderQuota,
  quotaBar,
  formatResetTime,
  loadQuota,
};
