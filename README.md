# APIRouter

APIRouter is a local CLI application that combines multiple AI API-key and OAuth accounts behind one API endpoint on your computer.

```text
AI client -> http://127.0.0.1:20228/v1 -> APIRouter -> selected provider
```

No hosted APIRouter relay is required. Requests are routed directly from the local process to the provider selected by your configuration.

APIRouter uses its own port, process lifecycle, data directory, cookies, headers, machine-ID salts, autostart service, provider config names, and local versioning. It does not control or reuse a running 9router instance.

## Local setup

Install dependencies and build the local CLI once after cloning:

```bash
npm install
npm --prefix cli install
npm run local:build
```

## Start

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
