#!/usr/bin/env node
import {
  escapeHtml,
  formatCombos,
  formatProviders,
  formatQuota,
  formatQuotaCollection,
  formatUsage,
  getCliToken,
  getDataDir,
  loadEnvFiles,
  LoginAttemptLimiter,
  mainKeyboard,
  parseAllowedChatIds,
  createTelegramSessionStore,
  splitMessage,
  usageKeyboard,
} from "./telegram-bot-lib.mjs";

loadEnvFiles();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN in .env.local or environment.");
  process.exit(1);
}

const apiRoot = `https://api.telegram.org/bot${token}`;
const apirouterBaseUrl = String(
  process.env.APIRouter_BASE_URL || process.env.BASE_URL || "http://127.0.0.1:20228",
).replace(/\/$/, "");
const allowedChatIds = parseAllowedChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS);
const cliToken = getCliToken();
const sessionStore = createTelegramSessionStore({ dataDir: getDataDir() });
const loginLimiter = new LoginAttemptLimiter();
const pendingLogins = new Set();
const loginPromptMessages = new Map();
const pendingActions = new Map();
const TERMINAL_PROVIDERS = [
  { id: "claude", name: "Claude Code", authType: "oauth", flow: "callback" },
  { id: "codex", name: "OpenAI Codex", authType: "oauth", flow: "callback" },
  { id: "gemini-cli", name: "Gemini CLI", authType: "oauth", flow: "callback" },
  { id: "github", name: "GitHub Copilot", authType: "oauth", flow: "device" },
  { id: "antigravity", name: "Antigravity", authType: "oauth", flow: "callback" },
  { id: "iflow", name: "iFlow AI", authType: "oauth", flow: "callback" },
  { id: "qwen", name: "Qwen Code", authType: "oauth", flow: "device" },
  { id: "kiro", name: "Kiro AI", authType: "oauth", flow: "device" },
  { id: "openrouter", name: "OpenRouter", authType: "apikey", credentialLabel: "API key" },
  { id: "glm", name: "GLM Coding", authType: "apikey", credentialLabel: "API key" },
  { id: "minimax", name: "Minimax Coding", authType: "apikey", credentialLabel: "API key" },
  { id: "kimi", name: "Kimi", authType: "apikey", credentialLabel: "API key" },
  { id: "openai", name: "OpenAI", authType: "apikey", credentialLabel: "API key" },
  { id: "anthropic", name: "Anthropic", authType: "apikey", credentialLabel: "API key" },
  { id: "gemini", name: "Gemini", authType: "apikey", credentialLabel: "API key" },
];
const sessionTtlDays = Math.max(1, Math.min(365, Number.parseInt(process.env.TELEGRAM_SESSION_TTL_DAYS || "30", 10) || 30));
const sessionMaxIdleMs = sessionTtlDays * 24 * 60 * 60 * 1000;
let authVersionCache = { value: null, expiresAt: 0 };
let offset = 0;
let stopping = false;

async function telegram(method, payload = {}) {
  const response = await fetch(`${apiRoot}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

async function apirouterRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(`${apirouterBaseUrl}${path}`, {
    method,
    headers: {
      "x-ar-cli-token": cliToken,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || data.message || `APIRouter HTTP ${response.status}`);
    error.status = response.status;
    error.path = path;
    error.method = method;
    throw error;
  }
  return data;
}

async function apirouter(path) {
  return apirouterRequest(path);
}

function actionKey(chatId) {
  return String(chatId);
}

async function clearPendingAction(chatId, { deletePrompt = false } = {}) {
  const key = actionKey(chatId);
  const action = pendingActions.get(key);
  pendingActions.delete(key);
  if (deletePrompt && action?.promptMessageId) {
    try {
      await telegram("deleteMessage", { chat_id: chatId, message_id: action.promptMessageId });
    } catch {}
  }
}

async function setPendingAction(chatId, action, promptText, replyMarkup = {
  inline_keyboard: [[{ text: "✖️ Cancel", callback_data: "action-cancel" }]],
}) {
  await clearPendingAction(chatId, { deletePrompt: true });
  const prompt = await send(chatId, promptText, replyMarkup);
  pendingActions.set(actionKey(chatId), { ...action, promptMessageId: prompt?.message_id });
}

function parseModels(text) {
  return [...new Set(String(text || "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean))];
}

function compactModelName(model) {
  if (typeof model === "string") return model.replace(/^models\//, "");
  return String(model?.name || model?.alias || model?.id || model?.model || "model").replace(/^models\//, "");
}

function modelValue(model, prefix) {
  if (typeof model === "string") {
    const id = model.replace(/^models\//, "");
    return id.includes("/") ? id : `${prefix}/${id}`;
  }
  if (model?.routedModel) return model.routedModel;
  if (model?.fullModel) return model.fullModel;
  const providerModelName = String(model?.name || "").startsWith("models/") ? model.name : "";
  const id = String(model?.id || model?.model || providerModelName).replace(/^models\//, "");
  if (!id) return null;
  if (id.includes("/")) return id;
  return `${prefix}/${id}`;
}

async function buildComboModelGroups() {
  const [providersData, modelsData] = await Promise.all([
    apirouter("/api/providers"),
    apirouter("/api/models"),
  ]);
  const connections = (providersData.connections || []).filter((connection) => connection.isActive !== false);
  const staticByProvider = new Map();
  for (const model of modelsData.models || []) {
    if (!model?.provider) continue;
    if (!staticByProvider.has(model.provider)) staticByProvider.set(model.provider, []);
    staticByProvider.get(model.provider).push(model);
  }

  const groups = new Map();
  for (const connection of connections) {
    const providerId = connection.provider;
    if (!groups.has(providerId)) {
      const staticModels = staticByProvider.get(providerId) || [];
      const routedPrefix = staticModels.find((model) => model.routedModel)?.routedModel?.split("/")[0];
      groups.set(providerId, {
        providerId,
        name: providerId,
        prefix: routedPrefix || connection.providerSpecificData?.prefix || providerId,
        connectionIds: [],
        models: staticModels.map((model) => ({
          name: compactModelName(model),
          value: modelValue(model, routedPrefix || providerId),
        })).filter((model) => model.value),
        loaded: false,
      });
    }
    groups.get(providerId).connectionIds.push(connection.id);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      models: [...new Map(group.models.map((model) => [model.value, model])).values()],
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function loadComboModelGroup(group) {
  if (group.loaded) return group;
  const liveLists = await Promise.all(group.connectionIds.slice(0, 3).map(async (connectionId) => {
    try {
      const data = await apirouter(`/api/providers/${encodeURIComponent(connectionId)}/models`);
      return data.models || [];
    } catch {
      return [];
    }
  }));
  const liveModels = liveLists.flat().map((model) => ({
    name: compactModelName(model),
    value: modelValue(model, group.prefix),
  })).filter((model) => model.value);
  return {
    ...group,
    loaded: true,
    models: [...new Map([...liveModels, ...group.models].map((model) => [model.value, model])).values()]
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function strategyLabel(strategy) {
  if (strategy === "round-robin") return "Round Robin";
  if (strategy === "fusion") return "Fusion";
  return "Fallback";
}

async function updateComboStrategy(comboName, patch, { previousName } = {}) {
  const settings = await apirouter("/api/settings");
  const comboStrategies = { ...(settings.comboStrategies || {}) };
  const sourceName = previousName || comboName;
  const next = { ...(comboStrategies[sourceName] || {}), ...patch };
  if (previousName && previousName !== comboName) delete comboStrategies[previousName];
  if (!next.fallbackStrategy || next.fallbackStrategy === "fallback") delete comboStrategies[comboName];
  else comboStrategies[comboName] = next;
  await apirouterRequest("/api/settings", { method: "PATCH", body: { comboStrategies } });
  return comboStrategies[comboName] || {};
}

async function removeComboStrategy(comboName) {
  const settings = await apirouter("/api/settings");
  const comboStrategies = { ...(settings.comboStrategies || {}) };
  if (!Object.prototype.hasOwnProperty.call(comboStrategies, comboName)) return;
  delete comboStrategies[comboName];
  await apirouterRequest("/api/settings", { method: "PATCH", body: { comboStrategies } });
}

function canAttemptLogin(chatId) {
  return allowedChatIds.size === 0 || allowedChatIds.has(String(chatId));
}

async function getDashboardAuthVersion({ force = false } = {}) {
  if (!force && authVersionCache.value && authVersionCache.expiresAt > Date.now()) {
    return authVersionCache.value;
  }
  const response = await fetch(`${apirouterBaseUrl}/api/auth/verify-password`, {
    headers: { "x-ar-cli-token": cliToken },
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.authVersion) {
    throw new Error(data.error || `Unable to validate Telegram session (HTTP ${response.status})`);
  }
  authVersionCache = { value: data.authVersion, expiresAt: Date.now() + 30_000 };
  return data.authVersion;
}

async function isAuthenticated(chatId) {
  if (!canAttemptLogin(chatId) || !sessionStore.has(chatId)) return false;
  const authVersion = await getDashboardAuthVersion();
  const validation = sessionStore.validate(chatId, { authVersion, maxIdleMs: sessionMaxIdleMs });
  if (!validation.valid) {
    sessionStore.revoke(chatId);
    return false;
  }
  return true;
}

async function verifyDashboardPassword(password) {
  const response = await fetch(`${apirouterBaseUrl}/api/auth/verify-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ar-cli-token": cliToken,
    },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  return {
    success: response.ok && data.success === true,
    status: response.status,
    error: data.error || (response.ok ? null : `APIRouter HTTP ${response.status}`),
    retryAfter: Number(data.retryAfter) || 0,
    authVersion: data.authVersion || null,
  };
}

async function deleteSensitiveMessage(message) {
  if (!message?.chat?.id || !message?.message_id) return;
  try {
    await telegram("deleteMessage", { chat_id: message.chat.id, message_id: message.message_id });
  } catch {}
}

async function requestLogin(message) {
  const chatId = message.chat.id;
  if (!canAttemptLogin(chatId)) {
    await send(chatId, "This chat is not allowed to sign in.");
    return;
  }
  if (message.chat.type !== "private") {
    await send(chatId, "For security, open a private chat with the bot to sign in using your Web UI password.");
    return;
  }
  if (pendingLogins.has(String(chatId)) && loginPromptMessages.has(String(chatId))) return;
  pendingLogins.add(String(chatId));
  const promptMessage = await send(
    chatId,
    "<b>Sign in to APIRouter</b>\n\nSend your current Web UI password. The bot will try to delete the password message immediately after receiving it.",
  );
  if (promptMessage?.message_id) loginPromptMessages.set(String(chatId), promptMessage.message_id);
}

async function deleteLoginPrompt(chatId) {
  const key = String(chatId);
  const messageId = loginPromptMessages.get(key);
  loginPromptMessages.delete(key);
  if (!messageId) return;
  try {
    await telegram("deleteMessage", { chat_id: chatId, message_id: messageId });
  } catch {}
}

async function attemptLogin(message, password) {
  const chatId = message.chat.id;
  const rate = loginLimiter.check(chatId);
  if (!rate.allowed) {
    await deleteSensitiveMessage(message);
    await send(chatId, `Too many failed attempts. Please try again in ${rate.retryAfter} seconds.`);
    return;
  }

  await deleteSensitiveMessage(message);
  const result = await verifyDashboardPassword(password);
  if (!result.success) {
    const nextRate = loginLimiter.fail(chatId);
    if (result.status === 403) {
      pendingLogins.delete(String(chatId));
      await send(chatId, escapeHtml(result.error || "The Web UI does not allow password sign-in."));
      return;
    }
    if (!nextRate.allowed || result.status === 429) {
      const retryAfter = Math.max(nextRate.retryAfter, result.retryAfter);
      await send(chatId, `Too many failed attempts. Please try again in ${retryAfter || 900} seconds.`);
      return;
    }
    await send(chatId, "The Web UI password is incorrect. Try again or send /cancel to stop.");
    return;
  }

  loginLimiter.success(chatId);
  pendingLogins.delete(String(chatId));
  await deleteLoginPrompt(chatId);
  authVersionCache = { value: result.authVersion, expiresAt: Date.now() + 30_000 };
  sessionStore.grant({
    chatId,
    userId: message.from?.id,
    username: message.from?.username,
    firstName: message.from?.first_name,
    chatType: message.chat.type,
    authVersion: result.authVersion,
  });
  await showMenu(chatId);
}

async function send(chatId, text, replyMarkup = undefined) {
  const chunks = splitMessage(text);
  let lastMessage = null;
  for (let index = 0; index < chunks.length; index += 1) {
    lastMessage = await telegram("sendMessage", {
      chat_id: chatId,
      text: chunks[index],
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(replyMarkup && index === chunks.length - 1 ? { reply_markup: replyMarkup } : {}),
    });
  }
  return lastMessage;
}

async function editOrSend(chatId, messageId, text, replyMarkup) {
  if (!messageId) return send(chatId, text, replyMarkup);
  if (text.length > 3900) {
    try { await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
    return send(chatId, text, replyMarkup);
  }
  try {
    await telegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    });
  } catch (error) {
    if (!String(error.message).includes("message is not modified")) await send(chatId, text, replyMarkup);
  }
}

async function showMenu(chatId, messageId) {
  const text = [
    "<b>APIRouter Local Bot</b>",
    "",
    `Server: <code>${escapeHtml(apirouterBaseUrl)}</code>`,
    "Choose a section:",
  ].join("\n");
  await editOrSend(chatId, messageId, text, mainKeyboard());
}

async function showProviders(chatId, messageId) {
  const data = await apirouter("/api/providers");
  await editOrSend(chatId, messageId, formatProviders(data.connections), {
    inline_keyboard: [
      [
        { text: "➕ Add provider", callback_data: "provider-add-page:0" },
        { text: "⚙️ Manage", callback_data: "provider-manage" },
      ],
      [{ text: "🔄 Refresh", callback_data: "providers" }],
      [{ text: "⬅️ Menu", callback_data: "menu" }],
    ],
  });
}

async function showProviderCatalog(chatId, messageId, page = 0) {
  const providers = TERMINAL_PROVIDERS;
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(providers.length / pageSize));
  const selectedPage = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
  const rows = providers.slice(selectedPage * pageSize, (selectedPage + 1) * pageSize).map((provider) => [{
    text: `${provider.authType === "oauth" ? "🌐" : "🔑"} ${provider.name}`.slice(0, 60),
    callback_data: `provider-add:${provider.id}`,
  }]);
  const pagination = [];
  if (selectedPage > 0) pagination.push({ text: "⬅️", callback_data: `provider-add-page:${selectedPage - 1}` });
  pagination.push({ text: `${selectedPage + 1}/${pageCount}`, callback_data: "noop" });
  if (selectedPage < pageCount - 1) pagination.push({ text: "➡️", callback_data: `provider-add-page:${selectedPage + 1}` });
  await editOrSend(chatId, messageId, [
    "<b>Add provider</b>",
    "",
    "🌐 OAuth: open the sign-in link, then send the callback URL.",
    "🔑 API key: enter a connection name and API key.",
  ].join("\n"), {
    inline_keyboard: [...rows, pagination, [{ text: "⬅️ Providers", callback_data: "providers" }]],
  });
}

async function beginProviderAdd(chatId, messageId, providerId) {
  const provider = TERMINAL_PROVIDERS.find((item) => item.id === providerId);
  if (!provider) throw new Error("The provider is not available in the Terminal UI catalog.");
  if (provider.authType === "oauth") {
    if (provider.flow === "device") return await beginProviderDeviceLogin(chatId, messageId, provider);
    return await beginProviderOAuthLogin(chatId, messageId, provider);
  }
  if (messageId) {
    try { await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
  }
  await setPendingAction(chatId, {
    type: "provider-add",
    step: "name",
    provider,
  }, `<b>Add ${escapeHtml(provider.name)}</b>\n\nSend a display name for this connection.`);
}

async function beginProviderOAuthLogin(chatId, messageId, provider) {
  const baseOrigin = new URL(apirouterBaseUrl).origin;
  const redirectUri = provider.id === "codex"
    ? "http://localhost:1455/auth/callback"
    : `${baseOrigin}/callback`;
  const authData = await apirouter(`/api/oauth/${encodeURIComponent(provider.id)}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`);
  if (!authData.authUrl) throw new Error("The provider did not return an authorization URL.");
  pendingActions.set(actionKey(chatId), {
    type: "provider-oauth-callback",
    provider,
    codeVerifier: authData.codeVerifier,
    state: authData.state,
    redirectUri: authData.redirectUri || redirectUri,
    promptMessageId: messageId,
  });
  await editOrSend(chatId, messageId, [
    `<b>Sign in to ${escapeHtml(provider.name)}</b>`,
    "",
    "1. Open the sign-in link below.",
    "2. Complete authentication in your browser.",
    "3. Copy the full callback URL from the address bar and send it to this chat.",
    "",
    `Expected callback: <code>${escapeHtml(authData.redirectUri || redirectUri)}</code>`,
  ].join("\n"), {
    inline_keyboard: [
      [{ text: "🌐 Open sign-in page", url: authData.authUrl }],
      [{ text: "✖️ Cancel", callback_data: "action-cancel" }],
    ],
  });
}

async function beginProviderDeviceLogin(chatId, messageId, provider) {
  const deviceData = await apirouter(`/api/oauth/${encodeURIComponent(provider.id)}/device-code`);
  const deviceCode = deviceData.device_code;
  const deviceUrl = deviceData.verification_uri_complete || deviceData.verification_uri;
  if (!deviceCode || !deviceUrl) throw new Error("The provider did not return a device sign-in URL.");
  pendingActions.set(actionKey(chatId), {
    type: "provider-oauth-device",
    provider,
    deviceCode,
    codeVerifier: deviceData.codeVerifier,
    extraData: deviceData.extraData || deviceData,
    deviceUrl,
    userCode: deviceData.user_code,
    promptMessageId: messageId,
  });
  await editOrSend(chatId, messageId, [
    `<b>Sign in to ${escapeHtml(provider.name)}</b>`,
    "",
    "1. Open the sign-in link.",
    deviceData.user_code ? `2. Enter code: <code>${escapeHtml(deviceData.user_code)}</code>` : "2. Confirm sign-in in your browser.",
    "3. Return here and select Check sign-in.",
  ].join("\n"), {
    inline_keyboard: [
      [{ text: "🌐 Open sign-in page", url: deviceUrl }],
      [{ text: "✅ Check sign-in", callback_data: "provider-oauth-poll" }],
      [{ text: "✖️ Cancel", callback_data: "action-cancel" }],
    ],
  });
}

async function showProviderManagement(chatId, messageId, notice = "") {
  const data = await apirouter("/api/providers");
  const connections = data.connections || [];
  const rows = connections.slice(0, 40).map((connection) => [{
    text: `${connection.isActive === false ? "⏸" : "🟢"} ${connection.name || connection.provider}`.slice(0, 60),
    callback_data: `provider-detail:${connection.id}`,
  }]);
  await editOrSend(chatId, messageId, `<b>Manage providers</b>${notice ? `\n\n⚠️ ${escapeHtml(notice)}` : ""}\n\nSelect a connection to disconnect, reconnect, or delete.${connections.length > 40 ? "\nOnly the first 40 connections are shown." : ""}`, {
    inline_keyboard: [
      ...rows,
      [{ text: "➕ Add provider", callback_data: "provider-add-page:0" }],
      [{ text: "⬅️ Providers", callback_data: "providers" }, { text: "🏠 Menu", callback_data: "menu" }],
    ],
  });
}

async function showProviderDetail(chatId, messageId, connectionId) {
  const data = await apirouter(`/api/providers/${encodeURIComponent(connectionId)}`);
  await renderProviderDetail(chatId, messageId, data.connection);
}

async function renderProviderDetail(chatId, messageId, connection) {
  const active = connection.isActive !== false;
  const text = [
    `<b>${escapeHtml(connection.name || connection.provider)}</b>`,
    `Provider: <code>${escapeHtml(connection.provider)}</code>`,
    `Status: ${active ? "🟢 Connected" : "⏸ Disconnected"}`,
    connection.defaultModel ? `Default model: <code>${escapeHtml(connection.defaultModel)}</code>` : null,
    connection.testStatus ? `Test: ${escapeHtml(connection.testStatus)}` : null,
  ].filter(Boolean).join("\n");
  await editOrSend(chatId, messageId, text, {
    inline_keyboard: [
      [{ text: active ? "⏸ Disconnect" : "▶️ Reconnect", callback_data: `provider-toggle:${connection.id}` }],
      [{ text: "🗑 Delete provider", callback_data: `provider-delete:${connection.id}` }],
      [{ text: "⬅️ List", callback_data: "provider-manage" }, { text: "🏠 Menu", callback_data: "menu" }],
    ],
  });
}

async function resolveCreatedConnection(result, providerId, name) {
  if (result?.connection?.id) return result.connection;
  const data = await apirouter("/api/providers");
  return (data.connections || []).find((connection) => connection.provider === providerId && connection.name === name) || null;
}

async function confirmProviderDelete(chatId, messageId, connectionId) {
  const data = await apirouter(`/api/providers/${encodeURIComponent(connectionId)}`);
  await editOrSend(chatId, messageId, `<b>Delete this provider?</b>\n\n${escapeHtml(data.connection.name || data.connection.provider)}\nThis action cannot be undone.`, {
    inline_keyboard: [
      [{ text: "🗑 Delete permanently", callback_data: `provider-delete-ok:${connectionId}` }],
      [{ text: "⬅️ Cancel", callback_data: `provider-detail:${connectionId}` }],
    ],
  });
}

async function showCombos(chatId, messageId) {
  const [data, settings] = await Promise.all([apirouter("/api/combos"), apirouter("/api/settings")]);
  const strategies = settings.comboStrategies || {};
  const strategyLines = (data.combos || []).filter((combo) => !combo.kind || combo.kind === "llm")
    .map((combo) => `• ${escapeHtml(combo.name)}: <b>${strategyLabel(strategies[combo.name]?.fallbackStrategy)}</b>`);
  const text = [formatCombos(data.combos), strategyLines.length ? "\n<b>Combo strategies</b>" : "", ...strategyLines].filter(Boolean).join("\n");
  await editOrSend(chatId, messageId, text, {
    inline_keyboard: [
      [
        { text: "➕ Add combo", callback_data: "combo-create" },
        { text: "⚙️ Manage", callback_data: "combo-manage" },
      ],
      [{ text: "🔄 Refresh", callback_data: "combos" }],
      [{ text: "⬅️ Menu", callback_data: "menu" }],
    ],
  });
}

async function showComboManagement(chatId, messageId) {
  const data = await apirouter("/api/combos");
  const combos = (data.combos || []).filter((combo) => !combo.kind || combo.kind === "llm");
  const visibleCombos = combos.slice(0, 60);
  await editOrSend(chatId, messageId, `<b>Manage combos</b>\n\nSelect a combo to rename it, edit models, change its strategy, or delete it.${combos.length > visibleCombos.length ? "\nOnly the first 60 combos are shown." : ""}`, {
    inline_keyboard: [
      ...visibleCombos.map((combo) => [{ text: `🔀 ${combo.name}`.slice(0, 60), callback_data: `combo-detail:${combo.id}` }]),
      [{ text: "➕ Add combo", callback_data: "combo-create" }],
      [{ text: "⬅️ Combos", callback_data: "combos" }, { text: "🏠 Menu", callback_data: "menu" }],
    ],
  });
}

async function getComboDetail(comboId) {
  const [combo, settings] = await Promise.all([
    apirouter(`/api/combos/${encodeURIComponent(comboId)}`),
    apirouter("/api/settings"),
  ]);
  return { combo, strategy: settings.comboStrategies?.[combo.name] || {} };
}

async function showComboDetail(chatId, messageId, comboId) {
  const { combo, strategy } = await getComboDetail(comboId);
  const selectedStrategy = strategy.fallbackStrategy || "fallback";
  const models = Array.isArray(combo.models) ? combo.models : [];
  const text = [
    `🔀 <b>${escapeHtml(combo.name)}</b>`,
    `Strategy: <b>${strategyLabel(selectedStrategy)}</b>`,
    selectedStrategy === "fusion" ? `Judge: <code>${escapeHtml(strategy.judgeModel || models[0] || "not set")}</code>` : null,
    "",
    `<b>Models (${models.length})</b>`,
    ...(models.length ? models.map((model) => `• <code>${escapeHtml(model)}</code>`) : ["No models configured."]),
  ].filter((line) => line !== null).join("\n");
  const rows = [
    [{ text: "✏️ Rename", callback_data: `combo-rename:${combo.id}` }, { text: "🧩 Edit models", callback_data: `combo-models:${combo.id}` }],
    [{ text: "🔁 Select strategy", callback_data: `combo-strategy:${combo.id}` }],
  ];
  if (selectedStrategy === "fusion") rows.push([{ text: "⚖️ Select judge model", callback_data: `combo-judge:${combo.id}` }]);
  rows.push(
    [{ text: "🗑 Delete combo", callback_data: `combo-delete:${combo.id}` }],
    [{ text: "⬅️ List", callback_data: "combo-manage" }, { text: "🏠 Menu", callback_data: "menu" }],
  );
  await editOrSend(chatId, messageId, text, { inline_keyboard: rows });
}

async function beginComboCreate(chatId, messageId) {
  if (messageId) {
    try { await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
  }
  await setPendingAction(chatId, { type: "combo-create", step: "name" }, [
    "<b>Add combo</b>",
    "",
    "Send a combo name. Use only letters, numbers, and <code>- _ .</code>",
  ].join("\n"));
}

function selectedModelsSummary(selectedModels) {
  if (!selectedModels.length) return "No models selected.";
  const visible = selectedModels.slice(0, 6).map((model) => `• <code>${escapeHtml(model)}</code>`);
  if (selectedModels.length > visible.length) visible.push(`• +${selectedModels.length - visible.length} more models`);
  return visible.join("\n");
}

async function startComboModelPicker(chatId, messageId, {
  mode,
  name,
  comboId,
  selectedModels = [],
} = {}) {
  const groups = await buildComboModelGroups();
  pendingActions.set(actionKey(chatId), {
    type: "combo-model-picker",
    mode,
    name,
    comboId,
    selectedModels: [...new Set(selectedModels)],
    groups,
    promptMessageId: messageId,
  });
  await showComboModelProviders(chatId, messageId);
}

async function showComboModelProviders(chatId, messageId) {
  const action = pendingActions.get(actionKey(chatId));
  if (action?.type !== "combo-model-picker") throw new Error("The model selection session has expired.");
  const buttons = action.groups.map((group, index) => {
    const selectedCount = group.models.filter((model) => action.selectedModels.includes(model.value)).length;
    const count = group.models.length ? ` · ${group.models.length}` : " · dynamic";
    return [{
      text: `${selectedCount ? `✅ ${selectedCount} · ` : "🤖 "}${group.name}${count}`.slice(0, 60),
      callback_data: `model-provider:${index}`,
    }];
  });
  await editOrSend(chatId, messageId, [
    `<b>Select models${action.name ? ` · ${escapeHtml(action.name)}` : ""}</b>`,
    `Selected: <b>${action.selectedModels.length}</b>`,
    "",
    selectedModelsSummary(action.selectedModels),
    "",
    "Select a provider to open its model list.",
  ].join("\n"), {
    inline_keyboard: [
      ...buttons,
      [{ text: "⌨️ Enter manually", callback_data: "model-manual" }],
      ...(action.selectedModels.length ? [[{ text: "🧹 Clear selection", callback_data: "model-clear" }]] : []),
      [{ text: "✅ Done", callback_data: "model-done" }, { text: "✖️ Cancel", callback_data: "action-cancel" }],
    ],
  });
}

async function showComboProviderModels(chatId, messageId, groupIndex, page = 0) {
  const action = pendingActions.get(actionKey(chatId));
  if (action?.type !== "combo-model-picker") throw new Error("The model selection session has expired.");
  const index = Number(groupIndex);
  if (!Number.isInteger(index) || !action.groups[index]) throw new Error("Invalid provider.");
  if (!action.groups[index].loaded) {
    await editOrSend(chatId, messageId, `<b>${escapeHtml(action.groups[index].name)}</b>\n\n⏳ Loading model list...`, {
      inline_keyboard: [[{ text: "⬅️ Providers", callback_data: "model-providers" }]],
    });
  }
  const group = await loadComboModelGroup(action.groups[index]);
  action.groups[index] = group;
  action.currentGroupIndex = index;
  pendingActions.set(actionKey(chatId), action);

  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(group.models.length / pageSize));
  const selectedPage = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
  const modelRows = group.models.slice(selectedPage * pageSize, (selectedPage + 1) * pageSize).map((model, rowIndex) => {
    const modelIndex = selectedPage * pageSize + rowIndex;
    const selected = action.selectedModels.includes(model.value);
    return [{
      text: `${selected ? "✅" : "➕"} ${model.name}`.slice(0, 60),
      callback_data: `model-toggle:${modelIndex}`,
    }];
  });
  const pagination = [];
  if (selectedPage > 0) pagination.push({ text: "⬅️", callback_data: `model-page:${selectedPage - 1}` });
  pagination.push({ text: `${selectedPage + 1}/${pageCount}`, callback_data: "noop" });
  if (selectedPage < pageCount - 1) pagination.push({ text: "➡️", callback_data: `model-page:${selectedPage + 1}` });
  const emptyText = group.models.length ? "Select a model to add or remove it." : "The provider returned no models. You can use manual entry instead.";
  const allGroupSelected = group.models.length > 0 && group.models.every((model) => action.selectedModels.includes(model.value));
  await editOrSend(chatId, messageId, [
    `<b>${escapeHtml(group.name)}</b>`,
    `Total selected: <b>${action.selectedModels.length}</b>`,
    "",
    emptyText,
  ].join("\n"), {
    inline_keyboard: [
      ...modelRows,
      pagination,
      ...(group.models.length ? [[{ text: allGroupSelected ? "☐ Clear this provider" : "☑️ Select this provider", callback_data: "model-group-all" }]] : []),
      [{ text: "⬅️ Providers", callback_data: "model-providers" }, { text: "✅ Done", callback_data: "model-done" }],
      [{ text: "⌨️ Enter manually", callback_data: "model-manual" }],
    ],
  });
}

async function finishComboModelPicker(chatId, messageId) {
  const action = pendingActions.get(actionKey(chatId));
  if (action?.type !== "combo-model-picker") throw new Error("The model selection session has expired.");
  if (!action.selectedModels.length) throw new Error("A combo requires at least one model.");
  if (action.mode === "create") {
    pendingActions.set(actionKey(chatId), {
      type: "combo-create",
      step: "strategy",
      name: action.name,
      models: action.selectedModels,
      promptMessageId: messageId,
    });
    await showComboStrategyPicker(chatId, messageId, null, { creating: true });
    return;
  }
  await apirouterRequest(`/api/combos/${encodeURIComponent(action.comboId)}`, {
    method: "PUT",
    body: { models: action.selectedModels },
  });
  pendingActions.delete(actionKey(chatId));
  await showComboDetail(chatId, messageId, action.comboId);
}

async function showComboStrategyPicker(chatId, messageId, comboId, { creating = false } = {}) {
  const action = pendingActions.get(actionKey(chatId));
  if (!creating) pendingActions.set(actionKey(chatId), { type: "combo-strategy", comboId });
  else if (!action || action.type !== "combo-create") throw new Error("The combo creation session has expired.");
  await editOrSend(chatId, messageId, [
    "<b>Select combo strategy</b>",
    "",
    "Fallback: try models in order when one fails.",
    "Round Robin: rotate models for each request.",
    "Fusion: run multiple models and use a judge to combine the results.",
  ].join("\n"), {
    inline_keyboard: [
      [{ text: "➡️ Fallback", callback_data: "combo-strategy-set:fallback" }],
      [{ text: "🔄 Round Robin", callback_data: "combo-strategy-set:round-robin" }],
      [{ text: "🧬 Fusion", callback_data: "combo-strategy-set:fusion" }],
      [{ text: "✖️ Cancel", callback_data: "action-cancel" }],
    ],
  });
}

async function confirmComboDelete(chatId, messageId, comboId) {
  const combo = await apirouter(`/api/combos/${encodeURIComponent(comboId)}`);
  await editOrSend(chatId, messageId, `<b>Delete this combo?</b>\n\n${escapeHtml(combo.name)}\nThis action cannot be undone.`, {
    inline_keyboard: [
      [{ text: "🗑 Delete permanently", callback_data: `combo-delete-ok:${comboId}` }],
      [{ text: "⬅️ Cancel", callback_data: `combo-detail:${comboId}` }],
    ],
  });
}

async function showUsage(chatId, messageId, period = "7d") {
  const allowedPeriods = new Set(["today", "24h", "7d", "30d", "60d", "all"]);
  const selectedPeriod = allowedPeriods.has(period) ? period : "7d";
  const stats = await apirouter(`/api/usage/stats?period=${selectedPeriod}`);
  await editOrSend(chatId, messageId, formatUsage(stats, selectedPeriod), usageKeyboard(selectedPeriod));
}

async function getQuotaConnections() {
  const data = await apirouter("/api/providers/client?page=1&pageSize=50&accountStatus=all&sort=priority");
  return data.connections || [];
}

async function showQuotaList(chatId, messageId) {
  const connections = await getQuotaConnections();
  const buttons = [[{ text: "🌐 All providers", callback_data: "quota-all" }]];
  buttons.push(...connections.slice(0, 30).map((connection) => [{
    text: `${connection.isActive === false ? "⏸" : "⏱"} ${connection.provider} · ${connection.name || connection.email || connection.id.slice(0, 8)}`.slice(0, 60),
    callback_data: `quota-account:${connection.id}`,
  }]));
  buttons.push([{ text: "⬅️ Menu", callback_data: "menu" }]);
  const suffix = connections.length > 30 ? "\nOnly the first 30 accounts are shown." : "";
  await editOrSend(
    chatId,
    messageId,
    `<b>Quota tracker</b>\n\nSelect an account to load its current quota.${suffix}`,
    { inline_keyboard: buttons },
  );
}

async function showQuota(chatId, messageId, connectionId, { force = false } = {}) {
  const data = await apirouter(`/api/usage/${encodeURIComponent(connectionId)}/summary${force ? "?force=1" : ""}`);
  await editOrSend(chatId, messageId, formatQuota(data.connection, data), {
    inline_keyboard: [
      [{ text: "🔄 Refresh quota", callback_data: `quota-refresh:${connectionId}` }],
      [{ text: "⬅️ Quota list", callback_data: "quota" }],
      [{ text: "🏠 Main menu", callback_data: "menu" }],
    ],
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function showAllQuotas(chatId, messageId, { force = false } = {}) {
  const connections = (await getQuotaConnections()).filter((connection) => connection.isActive !== false).slice(0, 20);
  const accounts = await mapWithConcurrency(connections, 3, async (connection) => {
    try {
      return await apirouter(`/api/usage/${encodeURIComponent(connection.id)}/summary${force ? "?force=1" : ""}`);
    } catch (error) {
      return { connection, error: error.message || String(error) };
    }
  });
  await editOrSend(chatId, messageId, formatQuotaCollection(accounts), {
    inline_keyboard: [
      [{ text: "🔄 Refresh all", callback_data: "quota-all-refresh" }],
      [{ text: "⬅️ Quota list", callback_data: "quota" }],
      [{ text: "🏠 Main menu", callback_data: "menu" }],
    ],
  });
}

async function showError(chatId, messageId, error) {
  const requestInfo = error.path ? `\n\nRequest: <code>${escapeHtml(`${error.method || "GET"} ${error.path}`)}</code>` : "";
  const text = `<b>Unable to complete the action</b>\n\n${escapeHtml(error.message || error)}${requestInfo}`;
  await editOrSend(chatId, messageId, text, {
    inline_keyboard: [[{ text: "⬅️ Menu", callback_data: "menu" }]],
  });
}

async function handlePendingAction(message, action) {
  const chatId = message.chat.id;
  const text = String(message.text || "").trim();

  if (action.type === "provider-oauth-callback") {
    let callbackUrl;
    try {
      callbackUrl = new URL(text);
    } catch {
      throw new Error("Invalid callback URL. Copy the full URL from your browser's address bar.");
    }
    const oauthError = callbackUrl.searchParams.get("error");
    if (oauthError) {
      throw new Error(callbackUrl.searchParams.get("error_description") || oauthError);
    }
    const code = callbackUrl.searchParams.get("code");
    if (!code) throw new Error("The callback URL does not contain an authorization code.");
    await deleteSensitiveMessage(message);
    const result = await apirouterRequest(`/api/oauth/${encodeURIComponent(action.provider.id)}/exchange`, {
      method: "POST",
      body: {
        code,
        redirectUri: action.redirectUri,
        codeVerifier: action.codeVerifier,
        state: callbackUrl.searchParams.get("state") || action.state,
      },
    });
    if (!result.success || !result.connection?.id) throw new Error(result.error || "Unable to create the OAuth connection.");
    await clearPendingAction(chatId, { deletePrompt: true });
    await renderProviderDetail(chatId, null, result.connection);
    return;
  }

  if (action.type === "provider-add") {
    if (action.step === "name") {
      if (!text) throw new Error("The connection name cannot be empty.");
      const prompt = await send(chatId, [
        `<b>${escapeHtml(action.provider.name)} · ${escapeHtml(text)}</b>`,
        "",
        action.provider.credentialRequired === false
          ? "Send <code>-</code> to create a local connection without a key."
          : `Send the ${escapeHtml(action.provider.credentialLabel)}. The credential message will be deleted immediately.`,
      ].join("\n"), { inline_keyboard: [[{ text: "✖️ Cancel", callback_data: "action-cancel" }]] });
      if (action.promptMessageId) {
        try { await telegram("deleteMessage", { chat_id: chatId, message_id: action.promptMessageId }); } catch {}
      }
      pendingActions.set(actionKey(chatId), {
        ...action,
        step: "credential",
        name: text.slice(0, 120),
        promptMessageId: prompt?.message_id,
      });
      return;
    }

    await deleteSensitiveMessage(message);
    const credential = action.provider.credentialRequired === false && text === "-" ? "" : text;
    if (!credential && action.provider.credentialRequired !== false) throw new Error(`${action.provider.credentialLabel} cannot be empty.`);
    const result = await apirouterRequest("/api/providers", {
      method: "POST",
      body: { provider: action.provider.id, name: action.name, apiKey: credential },
    });
    const connection = await resolveCreatedConnection(result, action.provider.id, action.name);
    await clearPendingAction(chatId, { deletePrompt: true });
    if (connection?.id) await renderProviderDetail(chatId, null, connection);
    else await showProviders(chatId);
    return;
  }

  if (action.type === "combo-create") {
    if (action.step === "name") {
      if (!/^[a-zA-Z0-9_.-]+$/.test(text)) throw new Error("Combo names may contain only letters, numbers, -, _, and .");
      await startComboModelPicker(chatId, action.promptMessageId, {
        mode: "create",
        name: text,
      });
      return;
    }
    if (action.step === "models") {
      const models = parseModels(text);
      if (!models.length) throw new Error("A combo requires at least one model.");
      pendingActions.set(actionKey(chatId), { ...action, step: "strategy", models });
      await showComboStrategyPicker(chatId, action.promptMessageId, null, { creating: true });
      return;
    }
  }

  if (action.type === "combo-rename") {
    if (!/^[a-zA-Z0-9_.-]+$/.test(text)) throw new Error("Combo names may contain only letters, numbers, -, _, and .");
    const combo = await apirouter(`/api/combos/${encodeURIComponent(action.comboId)}`);
    const updated = await apirouterRequest(`/api/combos/${encodeURIComponent(action.comboId)}`, {
      method: "PUT",
      body: { name: text },
    });
    await updateComboStrategy(updated.name, {}, { previousName: combo.name });
    await clearPendingAction(chatId, { deletePrompt: true });
    await showComboDetail(chatId, null, action.comboId);
    return;
  }

  if (action.type === "combo-models") {
    const models = parseModels(text);
    if (!models.length) throw new Error("A combo requires at least one model.");
    await apirouterRequest(`/api/combos/${encodeURIComponent(action.comboId)}`, { method: "PUT", body: { models } });
    await clearPendingAction(chatId, { deletePrompt: true });
    await showComboDetail(chatId, null, action.comboId);
    return;
  }

  if (action.type === "combo-judge") {
    const judgeModel = parseModels(text)[0];
    if (!judgeModel) throw new Error("The judge model cannot be empty.");
    const combo = await apirouter(`/api/combos/${encodeURIComponent(action.comboId)}`);
    await updateComboStrategy(combo.name, { fallbackStrategy: "fusion", judgeModel });
    await clearPendingAction(chatId, { deletePrompt: true });
    await showComboDetail(chatId, null, action.comboId);
  }
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = String(message.text || "").trim();
  const command = text.split(/\s+/)[0].split("@")[0].toLowerCase();
  if (command === "/id") {
    await send(chatId, `Chat ID: <code>${chatId}</code>`);
    return;
  }

  let authenticated = false;
  try {
    authenticated = await isAuthenticated(chatId);
  } catch (error) {
    await send(chatId, `<b>Unable to verify the session</b>\n\n${escapeHtml(error.message)}`);
    return;
  }
  if (!authenticated) {
    if (command === "/cancel") {
      pendingLogins.delete(String(chatId));
      await deleteLoginPrompt(chatId);
      await send(chatId, "Sign-in canceled.");
      return;
    }
    const inlinePassword = command === "/login" ? text.split(/\s+/).slice(1).join(" ") : "";
    if (inlinePassword) return await attemptLogin(message, inlinePassword);
    if (pendingLogins.has(String(chatId)) && text && !text.startsWith("/")) {
      return await attemptLogin(message, text);
    }
    return await requestLogin(message);
  }

  sessionStore.touch(chatId);
  if (command === "/cancel") {
    const hadAction = pendingActions.has(actionKey(chatId));
    await clearPendingAction(chatId, { deletePrompt: true });
    await send(chatId, hadAction ? "Action canceled." : "There is no pending action.");
    return;
  }
  if (command === "/logout") {
    sessionStore.revoke(chatId);
    pendingLogins.delete(String(chatId));
    await clearPendingAction(chatId, { deletePrompt: true });
    await deleteLoginPrompt(chatId);
    await send(chatId, "Signed out. The next connection will require your Web UI password again.");
    return;
  }

  try {
    const action = pendingActions.get(actionKey(chatId));
    if (action && text && !text.startsWith("/")) return await handlePendingAction(message, action);
    if (["/start", "/menu", "/help", "/providers", "/combos", "/quota", "/usage"].includes(command)) {
      await clearPendingAction(chatId, { deletePrompt: true });
    }
    if (["/start", "/menu", "/help"].includes(command)) return await showMenu(chatId);
    if (command === "/providers") return await showProviders(chatId);
    if (command === "/combos") return await showCombos(chatId);
    if (command === "/quota") return await showQuotaList(chatId);
    if (command === "/usage") return await showUsage(chatId, null, text.split(/\s+/)[1] || "7d");
    await showMenu(chatId);
  } catch (error) {
    console.error(`[Telegram message] ${error.method || "ACTION"} ${error.path || command || "input"}: ${error.message}`);
    if (error.status === 404 && error.path?.startsWith("/api/providers/")) {
      return await showProviderManagement(
        chatId,
        null,
        "The selected connection no longer exists. The list has been refreshed.",
      );
    }
    await showError(chatId, null, error);
  }
}

async function handleCallback(query) {
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  if (!chatId) return;
  let authenticated = false;
  try {
    authenticated = await isAuthenticated(chatId);
  } catch (error) {
    await telegram("answerCallbackQuery", { callback_query_id: query.id, text: "Unable to verify the session.", show_alert: true });
    return;
  }
  if (!authenticated) {
    await telegram("answerCallbackQuery", { callback_query_id: query.id, text: "This session is not signed in. Send /login.", show_alert: true });
    return;
  }

  sessionStore.touch(chatId);

  await telegram("answerCallbackQuery", { callback_query_id: query.id });
  try {
    if (query.data === "noop") return;
    if (query.data === "action-cancel") {
      await clearPendingAction(chatId, { deletePrompt: false });
      return await showMenu(chatId, messageId);
    }
    if (query.data === "menu") {
      await clearPendingAction(chatId, { deletePrompt: false });
      return await showMenu(chatId, messageId);
    }
    if (query.data === "providers") {
      await clearPendingAction(chatId, { deletePrompt: false });
      return await showProviders(chatId, messageId);
    }
    if (query.data === "provider-manage") return await showProviderManagement(chatId, messageId);
    if (query.data?.startsWith("provider-add-page:")) return await showProviderCatalog(chatId, messageId, query.data.slice(18));
    if (query.data?.startsWith("provider-add:")) return await beginProviderAdd(chatId, messageId, query.data.slice(13));
    if (query.data === "provider-oauth-poll") {
      const action = pendingActions.get(actionKey(chatId));
      if (action?.type !== "provider-oauth-device") throw new Error("The provider sign-in session has expired.");
      const result = await apirouterRequest(`/api/oauth/${encodeURIComponent(action.provider.id)}/poll`, {
        method: "POST",
        body: {
          deviceCode: action.deviceCode,
          codeVerifier: action.codeVerifier,
          extraData: action.extraData,
        },
      });
      if (result.pending) {
        return await editOrSend(chatId, messageId, [
          `<b>Sign in to ${escapeHtml(action.provider.name)}</b>`,
          "",
          "⏳ The provider is still waiting for authentication.",
          "Complete sign-in in your browser, then check again.",
          action.userCode ? `Code: <code>${escapeHtml(action.userCode)}</code>` : null,
        ].filter(Boolean).join("\n"), {
          inline_keyboard: [
            [{ text: "🌐 Reopen sign-in page", url: action.deviceUrl }],
            [{ text: "✅ Check again", callback_data: "provider-oauth-poll" }],
            [{ text: "✖️ Cancel", callback_data: "action-cancel" }],
          ],
        });
      }
      if (!result.success || !result.connection?.id) throw new Error(result.errorDescription || result.error || "Unable to create the OAuth connection.");
      pendingActions.delete(actionKey(chatId));
      return await renderProviderDetail(chatId, messageId, result.connection);
    }
    if (query.data?.startsWith("provider-detail:")) return await showProviderDetail(chatId, messageId, query.data.slice(16));
    if (query.data?.startsWith("provider-toggle:")) {
      const connectionId = query.data.slice(16);
      const data = await apirouter(`/api/providers/${encodeURIComponent(connectionId)}`);
      await apirouterRequest(`/api/providers/${encodeURIComponent(connectionId)}`, {
        method: "PUT",
        body: { isActive: data.connection.isActive === false },
      });
      return await showProviderDetail(chatId, messageId, connectionId);
    }
    if (query.data?.startsWith("provider-delete-ok:")) {
      const connectionId = query.data.slice(19);
      await apirouterRequest(`/api/providers/${encodeURIComponent(connectionId)}`, { method: "DELETE" });
      return await showProviderManagement(chatId, messageId);
    }
    if (query.data?.startsWith("provider-delete:")) return await confirmProviderDelete(chatId, messageId, query.data.slice(16));

    if (query.data === "combos") {
      await clearPendingAction(chatId, { deletePrompt: false });
      return await showCombos(chatId, messageId);
    }
    if (query.data === "combo-manage") return await showComboManagement(chatId, messageId);
    if (query.data === "combo-create") return await beginComboCreate(chatId, messageId);
    if (query.data?.startsWith("combo-detail:")) return await showComboDetail(chatId, messageId, query.data.slice(13));
    if (query.data?.startsWith("combo-rename:")) {
      const comboId = query.data.slice(13);
      const combo = await apirouter(`/api/combos/${encodeURIComponent(comboId)}`);
      if (messageId) {
        try { await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
      }
      return await setPendingAction(chatId, { type: "combo-rename", comboId }, `<b>Rename ${escapeHtml(combo.name)}</b>\n\nSend the new combo name.`);
    }
    if (query.data?.startsWith("combo-models:")) {
      const comboId = query.data.slice(13);
      const combo = await apirouter(`/api/combos/${encodeURIComponent(comboId)}`);
      return await startComboModelPicker(chatId, messageId, {
        mode: "edit",
        name: combo.name,
        comboId,
        selectedModels: combo.models || [],
      });
    }
    if (query.data === "model-providers") return await showComboModelProviders(chatId, messageId);
    if (query.data?.startsWith("model-provider:")) return await showComboProviderModels(chatId, messageId, query.data.slice(15), 0);
    if (query.data?.startsWith("model-page:")) {
      const action = pendingActions.get(actionKey(chatId));
      return await showComboProviderModels(chatId, messageId, action?.currentGroupIndex, query.data.slice(11));
    }
    if (query.data?.startsWith("model-toggle:")) {
      const action = pendingActions.get(actionKey(chatId));
      if (action?.type !== "combo-model-picker") throw new Error("The model selection session has expired.");
      const group = action.groups[action.currentGroupIndex];
      const modelIndex = Number(query.data.slice(13));
      const model = group?.models?.[modelIndex];
      if (!model) throw new Error("Invalid model.");
      if (action.selectedModels.includes(model.value)) {
        action.selectedModels = action.selectedModels.filter((value) => value !== model.value);
      } else {
        action.selectedModels.push(model.value);
      }
      pendingActions.set(actionKey(chatId), action);
      return await showComboProviderModels(chatId, messageId, action.currentGroupIndex, Math.floor(modelIndex / 8));
    }
    if (query.data === "model-group-all") {
      const action = pendingActions.get(actionKey(chatId));
      if (action?.type !== "combo-model-picker") throw new Error("The model selection session has expired.");
      const group = action.groups[action.currentGroupIndex];
      const values = group.models.map((model) => model.value);
      const allSelected = values.length > 0 && values.every((value) => action.selectedModels.includes(value));
      action.selectedModels = allSelected
        ? action.selectedModels.filter((value) => !values.includes(value))
        : [...new Set([...action.selectedModels, ...values])];
      pendingActions.set(actionKey(chatId), action);
      return await showComboProviderModels(chatId, messageId, action.currentGroupIndex, 0);
    }
    if (query.data === "model-clear") {
      const action = pendingActions.get(actionKey(chatId));
      if (action?.type !== "combo-model-picker") throw new Error("The model selection session has expired.");
      action.selectedModels = [];
      pendingActions.set(actionKey(chatId), action);
      return await showComboModelProviders(chatId, messageId);
    }
    if (query.data === "model-manual") {
      const action = pendingActions.get(actionKey(chatId));
      if (action?.type !== "combo-model-picker") throw new Error("The model selection session has expired.");
      const nextAction = action.mode === "create"
        ? { type: "combo-create", step: "models", name: action.name }
        : { type: "combo-models", comboId: action.comboId };
      return await setPendingAction(chatId, nextAction, [
        `<b>Enter models manually · ${escapeHtml(action.name || "combo")}</b>`,
        "",
        "Send the full model list separated by commas or new lines.",
        action.selectedModels.length ? `<code>${escapeHtml(action.selectedModels.join(", "))}</code>` : "Example: <code>cx/gpt-5.3-codex, cc/claude-sonnet</code>",
      ].join("\n"));
    }
    if (query.data === "model-done") return await finishComboModelPicker(chatId, messageId);
    if (query.data?.startsWith("combo-strategy:")) return await showComboStrategyPicker(chatId, messageId, query.data.slice(15));
    if (query.data?.startsWith("combo-strategy-set:")) {
      const strategy = query.data.slice(19);
      const action = pendingActions.get(actionKey(chatId));
      if (!action) throw new Error("The strategy selection session has expired.");
      if (action.type === "combo-create" && action.step === "strategy") {
        const combo = await apirouterRequest("/api/combos", {
          method: "POST",
          body: { name: action.name, models: action.models, kind: "llm" },
        });
        if (strategy !== "fallback") {
          await updateComboStrategy(combo.name, {
            fallbackStrategy: strategy,
            ...(strategy === "fusion" ? { judgeModel: action.models[0] } : {}),
          });
        }
        await clearPendingAction(chatId, { deletePrompt: false });
        return await showComboDetail(chatId, messageId, combo.id);
      }
      if (action.type === "combo-strategy") {
        const combo = await apirouter(`/api/combos/${encodeURIComponent(action.comboId)}`);
        await updateComboStrategy(combo.name, {
          fallbackStrategy: strategy,
          ...(strategy === "fusion" ? { judgeModel: action.models?.[0] || combo.models?.[0] || "" } : {}),
        });
        pendingActions.delete(actionKey(chatId));
        return await showComboDetail(chatId, messageId, action.comboId);
      }
      throw new Error("Invalid strategy selection session.");
    }
    if (query.data?.startsWith("combo-judge:")) {
      const comboId = query.data.slice(12);
      const combo = await apirouter(`/api/combos/${encodeURIComponent(comboId)}`);
      if (messageId) {
        try { await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
      }
      return await setPendingAction(chatId, { type: "combo-judge", comboId }, [
        `<b>Judge model · ${escapeHtml(combo.name)}</b>`,
        "",
        "Send the model to use for combining Fusion results.",
        `Model trong combo: <code>${escapeHtml((combo.models || []).join(", "))}</code>`,
      ].join("\n"));
    }
    if (query.data?.startsWith("combo-delete-ok:")) {
      const comboId = query.data.slice(16);
      const combo = await apirouter(`/api/combos/${encodeURIComponent(comboId)}`);
      await apirouterRequest(`/api/combos/${encodeURIComponent(comboId)}`, { method: "DELETE" });
      await removeComboStrategy(combo.name);
      return await showComboManagement(chatId, messageId);
    }
    if (query.data?.startsWith("combo-delete:")) return await confirmComboDelete(chatId, messageId, query.data.slice(13));

    if (query.data === "quota") return await showQuotaList(chatId, messageId);
    if (query.data === "quota-all") return await showAllQuotas(chatId, messageId);
    if (query.data === "quota-all-refresh") return await showAllQuotas(chatId, messageId, { force: true });
    if (query.data?.startsWith("usage:")) return await showUsage(chatId, messageId, query.data.slice(6));
    if (query.data?.startsWith("quota-account:")) return await showQuota(chatId, messageId, query.data.slice(14));
    if (query.data?.startsWith("quota-refresh:")) return await showQuota(chatId, messageId, query.data.slice(14), { force: true });
    return await showMenu(chatId, messageId);
  } catch (error) {
    console.error(`[Telegram callback] ${error.method || "ACTION"} ${error.path || query.data}: ${error.message}`);
    if (error.status === 404 && error.path?.startsWith("/api/providers/")) {
      return await showProviderManagement(
        chatId,
        messageId,
        "The connection referenced by the old button no longer exists. The list has been refreshed.",
      );
    }
    await showError(chatId, messageId, error);
  }
}

async function poll() {
  while (!stopping) {
    try {
      const updates = await telegram("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query"],
      });
      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.message) await handleMessage(update.message);
        if (update.callback_query) await handleCallback(update.callback_query);
      }
    } catch (error) {
      if (stopping) break;
      console.error(`[Telegram] ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    console.log("Stopping Telegram bot...");
  });
}

await telegram("setMyCommands", {
  commands: [
    { command: "menu", description: "Open the APIRouter menu" },
    { command: "providers", description: "List providers" },
    { command: "combos", description: "List combos" },
    { command: "usage", description: "Show usage statistics" },
    { command: "quota", description: "Track quota" },
    { command: "login", description: "Sign in with the Web UI password" },
    { command: "logout", description: "Clear the Telegram sign-in session" },
    { command: "cancel", description: "Cancel password entry" },
    { command: "id", description: "Show the Telegram chat ID" },
  ],
});

console.log(`APIRouter Telegram bot started for ${apirouterBaseUrl}`);
console.log(`Telegram sessions: ${sessionStore.path}`);
console.log(`Telegram session idle TTL: ${sessionTtlDays} day(s)`);
if (!allowedChatIds.size) console.warn("No TELEGRAM_ALLOWED_CHAT_IDS configured. Any private chat with the Web UI password can authenticate.");
await poll();
