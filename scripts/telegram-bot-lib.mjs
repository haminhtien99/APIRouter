import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import machineIdPackage from "node-machine-id";

const { machineIdSync } = machineIdPackage;

const CLI_AUTH_SALT = "apirouter-cli-auth";
const MAX_MESSAGE_LENGTH = 3900;

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function loadEnvFiles(files = [".env.local", ".env"]) {
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf8");
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
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function parseAllowedChatIds(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function getDataDir(env = process.env) {
  if (env.DATA_DIR) return env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "apirouter");
  }
  return path.join(os.homedir(), ".apirouter");
}

function readOrCreate(file, createValue) {
  try {
    const value = fs.readFileSync(file, "utf8").trim();
    if (value) return value;
  } catch {}

  const value = createValue();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { mode: 0o600 });
  return value;
}

export function getCliToken(dataDir = getDataDir()) {
  const rawMachineId = readOrCreate(path.join(dataDir, "machine-id"), () => {
    try {
      return machineIdSync();
    } catch {
      return crypto.randomUUID();
    }
  });
  const cliSecret = readOrCreate(
    path.join(dataDir, "auth", "cli-secret"),
    () => crypto.randomBytes(32).toString("hex"),
  );

  return crypto
    .createHash("sha256")
    .update(rawMachineId + CLI_AUTH_SALT + cliSecret)
    .digest("hex")
    .slice(0, 16);
}

export function createTelegramSessionStore({
  dataDir = getDataDir(),
  filePath = process.env.TELEGRAM_SESSION_FILE,
  now = () => new Date(),
} = {}) {
  const sessionPath = filePath || path.join(dataDir, "telegram-bot", "sessions.json");
  let state = { version: 1, chats: {} };

  try {
    const parsed = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.chats && typeof parsed.chats === "object") {
      state = { version: 1, chats: parsed.chats };
    }
  } catch {}

  function persist() {
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    const temporaryPath = `${sessionPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, sessionPath);
    try { fs.chmodSync(sessionPath, 0o600); } catch {}
  }

  function get(chatId) {
    return state.chats[String(chatId)] || null;
  }

  return {
    path: sessionPath,
    has(chatId) {
      return !!get(chatId);
    },
    get,
    grant(chat = {}) {
      const chatId = String(chat.chatId);
      const timestamp = now().toISOString();
      state.chats[chatId] = {
        chatId,
        userId: chat.userId == null ? null : String(chat.userId),
        username: chat.username || null,
        firstName: chat.firstName || null,
        chatType: chat.chatType || null,
        authVersion: chat.authVersion || null,
        authenticatedAt: state.chats[chatId]?.authenticatedAt || timestamp,
        lastSeenAt: timestamp,
      };
      persist();
      return state.chats[chatId];
    },
    touch(chatId) {
      const session = get(chatId);
      if (!session) return false;
      const currentTime = now();
      const previousTime = new Date(session.lastSeenAt || 0);
      if (Number.isFinite(previousTime.getTime()) && currentTime.getTime() - previousTime.getTime() < 60 * 60 * 1000) {
        return true;
      }
      session.lastSeenAt = currentTime.toISOString();
      persist();
      return true;
    },
    validate(chatId, { authVersion, maxIdleMs } = {}) {
      const session = get(chatId);
      if (!session) return { valid: false, reason: "missing" };
      if (!session.authVersion || !authVersion || session.authVersion !== authVersion) {
        return { valid: false, reason: "auth-changed" };
      }
      if (Number.isFinite(maxIdleMs) && maxIdleMs > 0) {
        const lastSeenAt = new Date(session.lastSeenAt || session.authenticatedAt || 0).getTime();
        if (!Number.isFinite(lastSeenAt) || now().getTime() - lastSeenAt > maxIdleMs) {
          return { valid: false, reason: "expired" };
        }
      }
      return { valid: true, reason: null };
    },
    revoke(chatId) {
      const key = String(chatId);
      if (!state.chats[key]) return false;
      delete state.chats[key];
      persist();
      return true;
    },
  };
}

export class LoginAttemptLimiter {
  constructor({ maxAttempts = 5, windowMs = 10 * 60 * 1000, lockMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.lockMs = lockMs;
    this.now = now;
    this.entries = new Map();
  }

  check(chatId) {
    const key = String(chatId);
    const currentTime = this.now();
    const entry = this.entries.get(key);
    if (!entry) return { allowed: true, retryAfter: 0 };
    if (entry.lockedUntil > currentTime) {
      return { allowed: false, retryAfter: Math.ceil((entry.lockedUntil - currentTime) / 1000) };
    }
    const attempts = entry.attempts.filter((timestamp) => currentTime - timestamp < this.windowMs);
    if (!attempts.length) this.entries.delete(key);
    else this.entries.set(key, { attempts, lockedUntil: 0 });
    return { allowed: true, retryAfter: 0 };
  }

  fail(chatId) {
    const key = String(chatId);
    const currentTime = this.now();
    const entry = this.entries.get(key) || { attempts: [], lockedUntil: 0 };
    entry.attempts = entry.attempts.filter((timestamp) => currentTime - timestamp < this.windowMs);
    entry.attempts.push(currentTime);
    if (entry.attempts.length >= this.maxAttempts) entry.lockedUntil = currentTime + this.lockMs;
    this.entries.set(key, entry);
    return this.check(key);
  }

  success(chatId) {
    this.entries.delete(String(chatId));
  }
}

export function formatNumber(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat("en", {
    notation: Math.abs(number) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(number);
}

export function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function splitMessage(text, maxLength = MAX_MESSAGE_LENGTH) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current && current.length + line.length + 1 > maxLength) {
      chunks.push(current);
      current = "";
    }
    if (line.length > maxLength) {
      if (current) chunks.push(current);
      for (let index = 0; index < line.length; index += maxLength) {
        chunks.push(line.slice(index, index + maxLength));
      }
      continue;
    }
    current += `${current ? "\n" : ""}${line}`;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function formatProviders(connections = []) {
  if (!connections.length) return "<b>Providers</b>\n\nNo providers found.";
  const groups = new Map();
  for (const connection of connections) {
    const provider = connection.provider || "unknown";
    if (!groups.has(provider)) groups.set(provider, []);
    groups.get(provider).push(connection);
  }

  const activeCount = connections.filter((item) => item.isActive !== false).length;
  const lines = [
    "<b>Providers</b>",
    `Total: <b>${connections.length}</b> · Active: <b>${activeCount}</b>`,
    "",
  ];
  for (const [provider, items] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`<b>${escapeHtml(provider)}</b> (${items.length})`);
    for (const item of items) {
      const state = item.isActive === false ? "⏸" : item.testStatus === "failed" ? "🔴" : "🟢";
      const name = item.name || item.email || item.displayName || item.id?.slice(0, 8) || "unnamed";
      const detail = item.defaultModel ? ` · ${escapeHtml(item.defaultModel)}` : "";
      lines.push(`${state} ${escapeHtml(name)}${detail}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function formatCombos(combos = []) {
  const visible = combos.filter((combo) => !combo.kind || combo.kind === "llm");
  if (!visible.length) return "<b>Combos</b>\n\nNo LLM combos found.";
  const lines = ["<b>Combos</b>", `Total: <b>${visible.length}</b>`, ""];
  for (const combo of visible) {
    const models = Array.isArray(combo.models) ? combo.models : [];
    lines.push(`🔀 <b>${escapeHtml(combo.name)}</b> · ${models.length} model`);
    for (const model of models.slice(0, 5)) lines.push(`  • ${escapeHtml(model)}`);
    if (models.length > 5) lines.push(`  • +${models.length - 5} more models`);
  }
  return lines.join("\n");
}

export function formatUsage(stats = {}, period = "7d") {
  const providerRows = Object.entries(stats.byProvider || {})
    .sort(([, a], [, b]) => (b.requests || 0) - (a.requests || 0))
    .slice(0, 8);
  const lines = [
    `<b>Usage · ${escapeHtml(period)}</b>`,
    `Requests: <b>${formatNumber(stats.totalRequests)}</b>`,
    `Input tokens: <b>${formatNumber(stats.totalPromptTokens)}</b>`,
    `Output tokens: <b>${formatNumber(stats.totalCompletionTokens)}</b>`,
    `Cached tokens: <b>${formatNumber(stats.totalCachedTokens)}</b>`,
    `Estimated cost: <b>$${Number(stats.totalCost || 0).toFixed(4)}</b>`,
  ];
  if (providerRows.length) {
    lines.push("", "<b>Theo provider</b>");
    for (const [provider, item] of providerRows) {
      lines.push(`• ${escapeHtml(provider)}: ${formatNumber(item.requests)} req · ${formatNumber((item.promptTokens || 0) + (item.completionTokens || 0))} tok`);
    }
  }
  return lines.join("\n");
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function humanizeKey(value) {
  return String(value || "Quota")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function extractQuotaRows(data, maxDepth = 4) {
  const rows = [];
  const seen = new Set();

  function visit(value, label, depth) {
    if (!value || typeof value !== "object" || depth > maxDepth) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, item?.name || `${label} ${index + 1}`, depth + 1));
      return;
    }

    const total = firstFinite(value.total, value.limit, value.capacity, value.max);
    const used = firstFinite(value.used, value.consumed, value.current, value.usage);
    const remaining = firstFinite(value.remaining, value.left, value.available);
    const usedPercent = firstFinite(value.usedPercent, value.used_percent, value.utilization, value.percentage);
    const remainingPercent = firstFinite(value.remainingPercentage, value.remaining_percent);
    const resetAt = value.resetAt || value.reset_at || value.resetsAt || value.resets_at || value.resetTime || null;
    const looksLikeQuota = total !== null || used !== null || remaining !== null || usedPercent !== null || remainingPercent !== null;

    if (looksLikeQuota) {
      const name = value.name || value.label || label || "Quota";
      const key = `${name}|${total}|${used}|${remaining}|${usedPercent}|${remainingPercent}|${resetAt}`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ name: humanizeKey(name), total, used, remaining, usedPercent, remainingPercent, resetAt });
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === "object") visit(child, key, depth + 1);
    }
  }

  visit(data, "Quota", 0);
  return rows.slice(0, 20);
}

export function formatQuota(connection, data) {
  const name = connection.name || connection.email || connection.displayName || connection.id?.slice(0, 8) || "Account";
  const rows = Array.isArray(data?.quotas) ? data.quotas : extractQuotaRows(data);
  const lines = [
    `<b>Quota · ${escapeHtml(connection.provider || "provider")}</b>`,
    escapeHtml(name),
  ];
  if (data?.plan) lines.push(`Plan: <b>${escapeHtml(data.plan)}</b>`);
  lines.push("");

  if (!rows.length) {
    lines.push(escapeHtml(data?.message || data?.error || "The provider did not return displayable quota data."));
    return lines.join("\n");
  }

  for (const row of rows) {
    let percentage = firstFinite(row.remainingPercentage, row.remainingPercent);
    if (percentage === null && row.usedPercent !== null) percentage = Math.max(0, 100 - row.usedPercent);
    if (percentage === null && row.total) {
      const remaining = row.remaining ?? Math.max(0, row.total - (row.used || 0));
      percentage = (remaining / row.total) * 100;
    }
    const safePercentage = percentage === null ? null : Math.max(0, Math.min(100, Math.round(percentage)));
    const status = safePercentage === null ? "⚪️" : safePercentage > 70 ? "🟢" : safePercentage >= 30 ? "🟡" : "🔴";
    const filled = safePercentage === null ? 0 : Math.round(safePercentage / 10);
    const bar = `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
    lines.push(`${status} <b>${escapeHtml(row.name)}</b>`);
    if (safePercentage !== null) lines.push(`<code>${bar}</code> <b>${safePercentage}%</b> remaining`);
    if (row.total) {
      lines.push(`Used: ${formatNumber(row.used || 0)} / ${formatNumber(row.total)}${row.unit ? ` ${escapeHtml(row.unit)}` : ""}`);
    } else if (row.unlimited) {
      lines.push("Limit: Unlimited");
    }
    const reset = formatDate(row.resetAt);
    if (reset) lines.push(`${row.recurring === false ? "Expires" : "Reset"}: ${escapeHtml(reset)}`);
    if (row.message) lines.push(escapeHtml(row.message));
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function formatQuotaCollection(accounts = []) {
  if (!accounts.length) return "<b>All-provider quota</b>\n\nNo accounts support quota tracking.";
  return [
    `<b>🌐 All-provider quota</b>\n${accounts.length} accounts`,
    ...accounts.map((account) => {
      if (account.error) {
        const connection = account.connection || account;
        return `<b>⚠️ ${escapeHtml(connection.provider || "provider")}</b>\n${escapeHtml(connection.name || connection.email || "account")}\n${escapeHtml(account.error)}`;
      }
      return formatQuota(account.connection || account, account);
    }),
  ].join("\n\n━━━━━━━━━━━━\n\n");
}

export function mainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🔌 Providers", callback_data: "providers" },
        { text: "🔀 Combos", callback_data: "combos" },
      ],
      [
        { text: "📊 Usage", callback_data: "usage:7d" },
        { text: "⏱ Quota", callback_data: "quota" },
      ],
      [{ text: "🔄 Refresh", callback_data: "menu" }],
    ],
  };
}

export function usageKeyboard(period = "7d") {
  const periods = ["today", "24h", "7d", "30d", "all"];
  return {
    inline_keyboard: [
      periods.map((item) => ({
        text: `${item === period ? "✓ " : ""}${item}`,
        callback_data: `usage:${item}`,
      })),
      [{ text: "⬅️ Menu", callback_data: "menu" }],
    ],
  };
}
