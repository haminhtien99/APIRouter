# Codex CLI ↔ Telegram

APIRouter can relay events from an independently running Codex CLI to its existing Telegram bot. A Codex agent is not required. Local Codex hooks write small event files into APIRouter's `DATA_DIR`; the bot reads them and writes approval decisions back. No webhook or extra server port is needed.

## What it does

| Codex hook | Telegram behavior |
| --- | --- |
| `PermissionRequest` | Sends the tool and requested operation with **Allow** and **Deny** buttons to chats following that session. The hook waits for the decision and returns it to Codex. |
| `Stop` | Saves the final assistant message for the **Latest output** request. It does not send output automatically. |
| `PostToolUse` | Warns chats following that session when a tool response clearly reports an error or nonzero exit code. It does not classify every semantic failure. |

The bot lists only active sessions whose Codex transcript identifies `model_provider` as `apirouter`. It finds sessions throughout the configured Codex home, including sessions started in other folders. Each entry shows `Name - "session name"` using the name from Codex's local session index, plus its folder and a short ID. Notifications use the same name, and the detail view shows the full ID. 🔐 marks pending approvals, and 👁 marks the followed session. If no name is recorded, the folder name is used. On Linux, it checks Codex's writer lock to exclude closed sessions even when their transcripts were changed recently. Each authenticated private chat chooses one session to follow. Merely enabling the Telegram bot does not subscribe the chat to every Codex session. If multiple chats follow the same session, the first approval decision wins.

## Set up

1. [Set up and start the APIRouter Telegram bot](telegram-bot.md), then send `/login` from your private Telegram chat. Keep the bot enabled.
2. From the APIRouter project directory, install the Codex hooks:

   ```bash
   npm run bot:telegram:codex:install
   ```

   This merges three handlers into `~/.codex/hooks.json` (or `$CODEX_HOME/hooks.json`) and creates a timestamped backup if the file exists. It records the current APIRouter `DATA_DIR` in the hook commands. Run the installer again if the project or `DATA_DIR` moves.
3. In Codex CLI, use `/hooks` to inspect and trust the new handlers. A session that was already running when hooks were installed may need to be resumed to load them.
4. Send `/codex` to the Telegram bot. Choose the APIRouter session you want to follow. A 🔐 marker means an approval is waiting, and 👁 marks the session followed in your chat. New notifications begin when you choose the session.

## Check the bridge

With APIRouter and the Telegram bot running, and after signing in from your private chat, run:

```bash
npm run bot:telegram:codex:smoke
```

First select an APIRouter session with `/codex`. The check sends a simulated `Stop` event silently, sends a failed `PostToolUse` warning, then waits for you to tap **Allow** or **Deny** on a simulated `PermissionRequest`. The diagnostic does **not** execute the displayed command or write its simulated result to the session transcript. It prints the decision JSON returned by the hook.

An approval prompt for a command run by Codex in this chat is separate from the independent Codex CLI's `PermissionRequest` hook. It will not appear in this Telegram bridge.

To check a real CLI session, confirm its APIRouter handlers are trusted under `/hooks`, select it with `/codex`, then ask Codex to give a short answer and finish the turn. Send `/codex output` or tap **Latest output** to fetch the answer once; finishing a turn does not send its output automatically. A tool with a clearly reported nonzero exit code should send a warning. An actual approval request should show Allow and Deny buttons; choosing Deny is a safe first check.

Telegram commands:

- `/codex` — list active local APIRouter Codex sessions by name, with folder, short ID, and approval markers, across folders.
- `/codex open SESSION_ID` — follow one session and view its pending approval. You can also tap its button in the list.
- `/codex output` — read the latest assistant output from the followed session's transcript.
- `/codex stream` — explicitly start editing one Telegram message as new assistant output appears.
- `/codex stream off` — stop those automatic edits.
- `/codex off` — stop following the session.

The session detail view offers **Allow**, **Deny**, **Latest output**, **Stream output**, and **Stop following**. Latest output reads the newest assistant text in the local JSONL transcript once per request. Its Telegram view emphasizes headings and bold text, keeps code blocks in a terminal-style font, and shows the end of long replies with an omission marker. Stream output uses the same view and updates a single message only when that text changes, checking every three seconds. Choosing Latest output, switching sessions, signing out, or restarting the bot stops the stream. The transcript stores completed assistant messages rather than every generated token, so stream updates occur when Codex writes a new message. It does not show the full chat transcript or an independently verified Git diff. Transcript parsing depends on Codex's current local format and may need updating if that format changes.

To remove only the APIRouter hook handlers:

```bash
npm run bot:telegram:codex:uninstall
```

## Waiting for approval

The bot sends a reminder every 15 minutes while the `PermissionRequest` hook is still alive and no decision has been made. Set `TELEGRAM_CODEX_REMINDER_MINUTES` in APIRouter's environment to change that interval. Older Telegram messages can still be clicked while the same hook is waiting; the first decision wins.

If the bot is not running or no chat follows the session when a permission request begins, the hook leaves that request for Codex's normal terminal approval prompt. Selecting the session later cannot transfer that existing terminal prompt to Telegram.

The installed hook timeout is **30 days**. This is a Codex hook limit configured by the installer, not a Telegram button lifetime. You can edit the `timeout` on the `PermissionRequest` handler in `hooks.json`. If the hook times out, is interrupted, or the CLI closes, its Telegram buttons can no longer decide that request. Codex then follows its normal approval flow.

Notifications go only to authenticated private chats already following the session when the event occurred. They are held for up to 24 hours if delivery is interrupted. Approval events remain queued while their hook is waiting. The bot stores bridge files under:

```text
DATA_DIR/telegram-bot/codex-bridge/
```

The directory contains event summaries and temporary approval decisions. Files are written with owner-only permissions. A pending approval's file timestamp is refreshed by the waiting hook; the bot only accepts a Telegram decision while that timestamp is recent.

The last `Stop` result for each session is kept in `last-stops/` for 30 days as a fallback when a transcript contains no assistant output.

## Scope and privacy

These are **user-level Codex hooks**, but the bridge accepts events only when the local transcript identifies the session's model provider as APIRouter. The bot shows the session ID and working directory. Only authenticated private chats following that session receive events; [the bot's allowlist](telegram-bot.md#4-restrict-access) can further restrict who may sign in.

Permission requests may contain commands or tool input, and output fetched on demand may contain project content. Use a private chat you control. The bot does not run a separate model to summarize or approve requests.

## Troubleshooting

- No session in `/codex`: confirm the CLI session uses APIRouter and the bot and CLI use the same `$CODEX_HOME` (or `~/.codex`). A brand-new session may need its first turn to create a transcript. On Linux, `flock` must be available to verify that the session's writer lock is held. Closed sessions are excluded even if their transcripts were changed recently.
- No message: verify the Telegram bot is running, `/login` succeeded, the session was selected before the event, and `/hooks` lists trusted APIRouter handlers.
- The bot answers Telegram but the smoke check reports no heartbeat: restart APIRouter and turn the bot back on so the current source is loaded. If using a previously packaged CLI, rebuild and reinstall it.
- Hook waits but no bot message: check that the installed command's `--data-dir` matches APIRouter's `DATA_DIR`.
- An old button says the request is no longer waiting: the CLI hook ended or another chat already responded; handle the current request in the CLI.
- If an already running session does not load newly installed hooks, resume it after installation.
