# APIRouter

APIRouter is a local CLI application that combines multiple AI API-key and OAuth accounts behind one API endpoint on your computer.

```text
AI client -> http://127.0.0.1:20228/v1 -> APIRouter -> selected provider
```

No hosted APIRouter relay is required. Requests are routed directly from the local process to the provider selected by your configuration.

APIRouter uses its own port, process lifecycle, data directory, cookies, headers, machine-ID salts, autostart service, provider config names, and local versioning. It does not control or reuse a running 9router instance.

## Local setup

Clone the repository on each computer, then install dependencies and build the local CLI:

```bash
git clone https://github.com/haminhtien99/APIRouter.git
cd APIRouter
npm ci
npm --prefix cli ci
npm run local:build
```

To run APIRouter from any directory, link the command once from the project root:

```bash
npm link
```

The link points to this checkout. After changing the source, run `npm run local:build` again; you do not need to repeat `npm link` unless you move the project.

## Update an installation

Each installation follows a Git branch. After new changes are available on that branch, stop APIRouter on the computer you want to update, then run:

```bash
apirouter update --check
apirouter update
apirouter --version
```

The update command fetches the branch tracked by that checkout. Applying an update requires a clean checkout and a fast-forward path from the current commit; it then installs the locked dependencies and rebuilds the CLI. Application data in `~/.apirouter` stays on that computer. If the command was not linked, run `npm run update:check` and `npm run update:local` from the project directory instead.

The Dashboard shows the available version and the `apirouter update` command when the tracked Git branch has newer commits. It checks on load and every five minutes. Exit APIRouter before running the command in a terminal; the Dashboard only displays the instructions.

An existing installation made before this command was added needs one manual update from its project directory:

```bash
git pull --ff-only
npm ci
npm --prefix cli ci
npm run local:build
```

For maintainer release steps, see [Releasing](docs/releasing.md).

## Codex and DeepSeek

The current integration targets Codex CLI 0.162.1 and the Responses API. Configure Codex in the Dashboard's CLI Tools page, then launch `codex -p apirouter`. After updating APIRouter, save the Codex configuration again to regenerate its model catalog from the installed client's cache, then start a new Codex session.

DeepSeek's official API has two primary model IDs: `ds/deepseek-v4-pro` (DeepSeek V4 Pro 0813) and `ds/deepseek-flash` (DeepSeek V4.1 Flash). Both support thinking and non-thinking modes, a 1M context and up to 384K output tokens; Flash also accepts images. Select an effort using the model picker or suffix, for example `ds/deepseek-flash(max)` or `ds/deepseek-v4-pro(none)`.

`deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are legacy API names served by current Flash. They are omitted from the picker to avoid duplicate entries. Saved routes using the previous local `deepseek-v4-pro-max` / `deepseek-v4-pro-none` variants should use `deepseek-v4-pro(max)` / `deepseek-v4-pro(none)` instead; saved `deepseek-v4.1-flash`, `deepseek-chat` and `deepseek-reasoner` routes should select a current model explicitly. See [DeepSeek's model details](https://api-docs.deepseek.com/quick_start/pricing/) and [Responses API compatibility](https://api-docs.deepseek.com/guides/responses_api/).

## Start

After linking, run from any directory:

```bash
apirouter
```

Without the link, run from the project root:

```bash
./apirouter
```

Useful options:

```bash
./apirouter --no-browser
./apirouter --port 8080
./apirouter --log
./apirouter --help
```

Dashboard: `http://127.0.0.1:20228/dashboard`

Unified API: `http://127.0.0.1:20228/v1`

APIRouter stores application data under `~/.apirouter` by default. Python is not required.

## Telegram bot

APIRouter includes an optional Telegram bot for providers, combos, usage, and quota tracking. Run `./apirouter`, then select `Telegram Bot: OFF → toggle` in the interface menu to turn it on. No separate chatbot command is required.

Configure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_CHAT_IDS` in `.env.local`. See `docs/telegram-bot.md` for setup and commands.

To choose an active APIRouter Codex CLI session to follow across folders, receive approval requests, and fetch output on demand in Telegram, see `docs/codex-telegram-bridge.md`.

## Codex APIRouter status

Codex's built-in `/status` describes the Codex session and cannot be replaced by a custom provider. APIRouter provides a separate read-only command:

```bash
./apirouter status-api
# alias matching the requested name:
./apirouter status_API
```

It shows the Codex model/provider configuration, resolves a selected combo into its model chain, and summarizes provider availability and usage. Applying Codex settings from Dashboard → CLI Tools installs the `$apirouter-status` skill into `~/.codex/skills/apirouter-status`.

Quota limits are loaded by default and rendered with the same normalized quota data as the Web UI:

```bash
./apirouter status_API --provider codex
./apirouter status_API --force
./apirouter status_API --no-quota
```

The same view is available without commands in the interactive Terminal UI:

```text
./apirouter
→ Terminal UI
→ Quota / Token Limits
→ All Active Accounts, Force Refresh, or a specific provider
```

## Attribution

The provider-routing engine is derived from the MIT-licensed 9router project. See `LICENSE` and the retained source history for attribution.
