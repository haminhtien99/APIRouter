import fs from "node:fs";
import path from "node:path";
import {
  codexBridgeFile,
  ensureCodexBridgePaths,
  getCodexBridgePaths,
  createCodexBridgeDecision,
  readCodexBridgeWatches,
  readCodexBridgeJson,
  removeCodexBridgeFile,
  writeCodexBridgeJson,
} from "./codex-telegram-bridge-lib.mjs";
import {
  getCodexHome,
  listApirouterSessions,
  readLatestCodexOutput,
} from "./codex-telegram-sessions.mjs";

const ACTIVE_HEARTBEAT_MS = 45_000;
const NOTIFICATION_RETENTION_MS = 24 * 60 * 60 * 1000;
const RESULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const STALE_APPROVAL_RETENTION_MS = 31 * 24 * 60 * 60 * 1000;
const POLL_MS = 1_000;

function minutesFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 24 * 60) : fallback;
}

export function createCodexTelegramBridge({
  dataDir,
  telegram,
  send,
  isAuthenticated,
  sessionStore,
  escapeHtml,
  codexHome = getCodexHome(),
  reminderMinutes = minutesFromEnv(process.env.TELEGRAM_CODEX_REMINDER_MINUTES, 15),
  now = () => Date.now(),
}) {
  const paths = getCodexBridgePaths(dataDir);
  const reminderMs = reminderMinutes * 60_000;
  let timer = null;
  let polling = false;
  let sessionCache = { expiresAt: 0, value: [] };

  function sessions({ force = false } = {}) {
    if (!force && now() < sessionCache.expiresAt) return sessionCache.value;
    const value = listApirouterSessions({ codexHome });
    sessionCache = { expiresAt: now() + 10_000, value };
    return value;
  }

  function sessionById(sessionId) {
    return sessions().find((session) => session.id === sessionId)
      || sessions({ force: true }).find((session) => session.id === sessionId)
      || null;
  }

  function watchedSession(chatId) {
    return readCodexBridgeWatches(paths)[String(chatId)]?.sessionId || null;
  }

  function watch(chatId, sessionId) {
    if (!sessionById(sessionId)) return false;
    ensureCodexBridgePaths(paths);
    const chats = readCodexBridgeWatches(paths);
    const previous = chats[String(chatId)];
    chats[String(chatId)] = previous?.sessionId === sessionId && Number.isFinite(Date.parse(previous.watchedAt))
      ? previous
      : { sessionId, watchedAt: new Date(now()).toISOString() };
    writeCodexBridgeJson(paths.watches, { chats });
    return true;
  }

  function unwatch(chatId) {
    const chats = readCodexBridgeWatches(paths);
    if (!chats[String(chatId)]) return false;
    delete chats[String(chatId)];
    writeCodexBridgeJson(paths.watches, { chats });
    return true;
  }

  function escaped(value, limit) {
    let result = "";
    for (const char of String(value ?? "")) {
      const next = escapeHtml(char);
      if (result.length + next.length > limit) return `${result}…`;
      result += next;
    }
    return result;
  }

  function eventFiles() {
    try {
      return fs.readdirSync(paths.events).filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name)).sort();
    } catch {
      return [];
    }
  }

  function activePermission(eventFile) {
    try {
      return now() - fs.statSync(eventFile).mtimeMs < ACTIVE_HEARTBEAT_MS;
    } catch {
      return false;
    }
  }

  async function authenticatedChats() {
    const result = [];
    for (const chat of sessionStore.list()) {
      if (chat.chatType !== "private") continue;
      try {
        if (await isAuthenticated(chat.chatId)) result.push(chat.chatId);
      } catch (error) {
        console.error(`[Codex Telegram] Unable to verify chat ${chat.chatId}: ${error.message}`);
      }
    }
    return result;
  }

  function pendingRequests(sessionId = "") {
    return eventFiles()
      .map((name) => {
        const file = path.join(paths.events, name);
        const event = readCodexBridgeJson(file);
        return event?.type === "permission" && activePermission(file)
          && !fs.existsSync(codexBridgeFile(paths.decisions, event.id))
          && (!sessionId || event.sessionId === sessionId)
          ? event
          : null;
      })
      .filter(Boolean);
  }

  function latestOutput(sessionId) {
    const session = sessionById(sessionId);
    if (!session) return null;
    const latest = readLatestCodexOutput(session.transcriptPath);
    if (latest) return latest;
    const fallback = lastStop(sessionId);
    return fallback ? { text: fallback.detail, phase: "final_answer" } : null;
  }

  function render(event, { reminder = false } = {}) {
    const heading = event.type === "permission"
      ? `${reminder ? "⏰ Reminder: " : "⚠️ "}Codex requests approval`
      : event.type === "stop" ? "🏁 Codex turn stopped" : "⚠️ Codex tool failed";
    const session = sessionById(event.sessionId);
    const lines = [
      `<b>${heading}</b>`,
      `Name - "<b>${escaped(session?.name || "Untitled session", 240)}</b>" · <code>${escaped(String(event.sessionId).slice(0, 8), 16)}</code>`,
    ];
    if (event.cwd) lines.push(`Directory: <code>${escaped(event.cwd, 220)}</code>`);
    if (event.toolName) lines.push(`Tool: <code>${escaped(event.toolName, 140)}</code>`);
    if (event.detail) lines.push("", `<pre>${escaped(event.detail, 2700)}</pre>`);
    if (event.type === "stop") lines.push("", "A stopped turn does not by itself confirm the task succeeded.");
    return lines.join("\n");
  }

  function approvalButtons(id) {
    return {
      inline_keyboard: [[
        { text: "✅ Allow", callback_data: `codex:allow:${id}` },
        { text: "⛔ Deny", callback_data: `codex:deny:${id}` },
      ]],
    };
  }

  async function pollEvent(eventFile, authenticatedChatIds) {
    const event = readCodexBridgeJson(eventFile);
    if (!event || !["permission", "stop", "tool-error"].includes(event.type)) return;
    if (event.type === "stop") {
      removeCodexBridgeFile(eventFile);
      return;
    }
    if (!sessionById(event.sessionId)) return;
    const watches = readCodexBridgeWatches(paths);
    const chatIds = authenticatedChatIds.filter((chatId) => {
      const watch = watches[String(chatId)];
      return watch?.sessionId === event.sessionId
        && new Date(watch.watchedAt).getTime() <= new Date(event.createdAt).getTime();
    });
    let stateFile;
    let decisionFile;
    try {
      stateFile = codexBridgeFile(paths.state, event.id);
      decisionFile = codexBridgeFile(paths.decisions, event.id);
      if (codexBridgeFile(paths.events, event.id) !== eventFile) return;
    } catch {
      return;
    }
    const age = now() - new Date(event.createdAt).getTime();
    if (event.type === "permission") {
      if (age > STALE_APPROVAL_RETENTION_MS && !activePermission(eventFile)) {
        removeCodexBridgeFile(eventFile);
        removeCodexBridgeFile(stateFile);
        removeCodexBridgeFile(decisionFile);
        return;
      }
      if (!activePermission(eventFile) || fs.existsSync(decisionFile)) return;
    } else if (!Number.isFinite(age) || age > NOTIFICATION_RETENTION_MS) {
      removeCodexBridgeFile(eventFile);
      removeCodexBridgeFile(stateFile);
      return;
    }

    const state = readCodexBridgeJson(stateFile) || { sentAt: {} };
    if (!state.sentAt || typeof state.sentAt !== "object") state.sentAt = {};
    for (const chatId of chatIds) {
      if (watchedSession(chatId) !== event.sessionId) continue;
      const key = String(chatId);
      const lastSent = Number(state.sentAt[key]) || 0;
      if (lastSent && (event.type !== "permission" || now() - lastSent < reminderMs)) continue;
      if (event.type === "permission" && (!activePermission(eventFile) || fs.existsSync(decisionFile))) break;
      try {
        await send(chatId, render(event, { reminder: !!lastSent }), event.type === "permission" ? approvalButtons(event.id) : undefined);
        state.sentAt[key] = now();
        writeCodexBridgeJson(stateFile, state);
      } catch (error) {
        console.error(`[Codex Telegram] Cannot deliver ${event.type} to ${chatId}: ${error.message}`);
      }
    }
    if (event.type !== "permission" && chatIds.length && chatIds.every((chatId) => state.sentAt[String(chatId)])) {
      removeCodexBridgeFile(eventFile);
      removeCodexBridgeFile(stateFile);
    }
  }

  function removeOrphanState() {
    let names;
    try { names = fs.readdirSync(paths.state); } catch { return; }
    for (const name of names) {
      if (!/^[0-9a-f-]{36}\.json$/i.test(name)) continue;
      const id = name.slice(0, -5);
      if (!fs.existsSync(codexBridgeFile(paths.events, id))) {
        removeCodexBridgeFile(codexBridgeFile(paths.state, id));
      }
    }
  }

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const files = eventFiles();
      if (!files.length) {
        removeOrphanState();
        return;
      }
      const chatIds = await authenticatedChats();
      for (const name of files.slice(0, 50)) {
        await pollEvent(path.join(paths.events, name), chatIds);
      }
      removeOrphanState();
    } catch (error) {
      console.error(`[Codex Telegram] ${error.message}`);
    } finally {
      polling = false;
    }
  }

  async function handleCallback(query) {
    const match = String(query.data || "").match(/^codex:(allow|deny):([0-9a-f-]{36})$/i);
    if (!match) return false;
    const chatId = query.message?.chat?.id;
    if (!chatId || query.message?.chat?.type !== "private") return true;
    const [, decision, id] = match;
    let eventFile;
    let decisionFile;
    try {
      eventFile = codexBridgeFile(paths.events, id);
      decisionFile = codexBridgeFile(paths.decisions, id);
    } catch {
      return true;
    }
    const event = readCodexBridgeJson(eventFile);
    if (event?.type !== "permission" || watchedSession(chatId) !== event.sessionId
      || !sessionById(event.sessionId) || !activePermission(eventFile)) {
      await send(chatId, "This Codex approval request is no longer waiting.");
      return true;
    }
    const accepted = createCodexBridgeDecision(decisionFile, {
      decision,
      chatId: String(chatId),
      createdAt: new Date(now()).toISOString(),
    });
    if (!accepted) {
      await send(chatId, "This Codex approval has already been answered.");
      return true;
    }
    const status = decision === "allow" ? "Approved" : "Denied";
    try {
      await telegram("editMessageText", {
        chat_id: chatId,
        message_id: query.message.message_id,
        text: `${render(event)}\n\n<b>${status} via Telegram.</b>`,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [] },
      });
    } catch {
      await send(chatId, `${status} sent to the waiting Codex hook.`);
    }
    return true;
  }

  function status() {
    const pending = pendingRequests()
      .map((event) => ({ sessionId: event.sessionId, toolName: event.toolName }));
    return { pending, reminderMinutes, path: paths.root };
  }

  function recentStops(limit = 5) {
    let names;
    try {
      names = fs.readdirSync(paths.lastStops).filter((name) => /^[0-9a-f]{64}\.json$/.test(name));
    } catch {
      return [];
    }
    const events = [];
    for (const name of names) {
      const file = path.join(paths.lastStops, name);
      const event = readCodexBridgeJson(file);
      const age = now() - new Date(event?.createdAt).getTime();
      if (!Number.isFinite(age) || age > RESULT_RETENTION_MS) {
        removeCodexBridgeFile(file);
        continue;
      }
      if (event?.type === "stop") events.push(event);
    }
    events.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    return events.slice(0, limit);
  }

  function lastStop(sessionId = "") {
    return recentStops(Number.MAX_SAFE_INTEGER).find((event) => !sessionId || event.sessionId === sessionId) || null;
  }

  function stopById(id) {
    return recentStops(Number.MAX_SAFE_INTEGER).find((event) => event.id === id) || null;
  }

  function start() {
    ensureCodexBridgePaths(paths);
    fs.writeFileSync(paths.heartbeat, `${process.pid}\n`, { mode: 0o600 });
    timer = setInterval(() => {
      try {
        const timestamp = new Date(now());
        fs.utimesSync(paths.heartbeat, timestamp, timestamp);
      } catch (error) {
        console.error(`[Codex Telegram] Cannot refresh bot heartbeat: ${error.message}`);
      }
      void poll();
    }, POLL_MS);
    void poll();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    removeCodexBridgeFile(paths.heartbeat);
  }

  return {
    start, stop, poll, handleCallback, status, recentStops, lastStop, stopById, render,
    sessions, sessionById, watchedSession, watch, unwatch, pendingRequests, latestOutput,
  };
}
