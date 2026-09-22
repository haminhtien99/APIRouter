# Local Telegram Bot

The Telegram bot provides a lightweight management interface for APIRouter:

- View providers and account status
- View combos and their model lists
- Review usage for `today`, `24h`, `7d`, `30d`, `60d`, or `all`
- Track quota for individual accounts
- Add, disconnect, reconnect, and delete provider API key or cookie connections
- Add, rename, edit, delete, and select a strategy for combos

The bot uses long polling, runs on the same machine as APIRouter, and requires no webhook or additional package.

## 1. Create a Bot

Create a bot with `@BotFather`, copy its token, and add it to `.env.local`:

```env
TELEGRAM_BOT_TOKEN=123456789:replace-with-bot-token
APIRouter_BASE_URL=http://127.0.0.1:20228
```

The bot uses the existing APIRouter Web UI password. You do not need to configure a separate Telegram password.

## 2. Enable the Bot

Start APIRouter:

```bash
./apirouter --no-browser
```

On the `Choose Interface` screen, select `Telegram Bot: OFF → toggle` to switch it to `ON`. APIRouter starts and stops the bot automatically, so no separate chatbot command is required. Select the same option again to turn the bot off.

The `npm run bot:telegram` command remains available for standalone development and diagnostics.

## 3. Sign In

Send `/start` or `/login` in a private chat with the bot. The bot asks for the current Web UI password and verifies it through APIRouter. After a successful login, the session is stored at:

```text
DATA_DIR/telegram-bot/sessions.json
```

The file contains only the chat ID, Telegram identity metadata, a non-reversible authentication version, and login/activity timestamps. It does not contain passwords or chat contents. The session remains valid after the bot restarts. Use `/logout` to delete the saved session and require the password on the next login.

Sessions expire after 30 inactive days by default. To change the expiration period, set:

```env
TELEGRAM_SESSION_TTL_DAYS=30
```

Existing Telegram sessions are automatically revoked when the Web UI password, `INITIAL_PASSWORD`, or the Password/OIDC/SAML authentication mode changes. The bot stores only an HMAC fingerprint of the authentication configuration, never the password or password hash.

## 4. Restrict Access

You can configure an allowlist as an additional restriction before password verification. Send `/id` to obtain a Telegram chat ID, then add it to `.env.local`:

```env
TELEGRAM_ALLOWED_CHAT_IDS=123456789
```

To allow multiple accounts, use a comma-separated list:

```env
TELEGRAM_ALLOWED_CHAT_IDS=123456789,987654321
```

Without `TELEGRAM_ALLOWED_CHAT_IDS`, any private-chat user who knows the correct Web UI password can sign in.

## Commands

- `/menu` — open the button menu
- `/providers` — view and manage providers
- `/combos` — view and manage combos
- `/usage 7d` — view usage; replace `7d` with another supported period
- `/quota` — select an account and view its quota
- `/login` — sign in with the Web UI password
- `/logout` — delete the saved Telegram session
- `/cancel` — cancel password entry or a pending management action
- `/id` — show the Telegram chat ID

## Security

The password is sent to the internal `/api/auth/verify-password` endpoint, protected by the CLI token, and compared with the same password or hash used by the Web UI. The endpoint does not create cookies or Web UI sessions and does not share the login page's failed-attempt lockout state.

The bot does not store the password and attempts to delete password messages immediately after receiving them. Telegram is still a third-party system, so sign in only through a private chat. Never share `.env.local`, the bot token, the `DATA_DIR` directory, `auth/cli-secret`, or the Telegram session file.

## Managing Providers

Open `Providers` and select `Add provider`. The available providers and authentication methods match the Terminal UI:

- OAuth callback: the bot creates a sign-in link. After authentication, copy the complete callback URL from the browser address bar and send it to the bot.
- OAuth device code: the bot displays a link and code. Complete authentication, then select `Check login`.
- API key: the bot asks for a display name and then the API key.

Messages containing an API key or callback URL are deleted immediately after receipt. API keys are not stored in bot state, and an OAuth verifier remains only in memory until the operation completes or is cancelled.

Select `Manage` to open an existing connection. You can disconnect, reconnect, or permanently delete it. Deletion always requires confirmation.

## Managing Combos

Open `Combos` and select `Add combo` or `Manage`. The bot lists active providers first, then loads and paginates the models for the selected provider. You can select multiple models, return to another provider, and continue selecting. A `✅` marks selected models and providers.

Manual entry remains available for a comma-separated or newline-separated model list, for example:

```text
cx/gpt-5.3-codex, cc/claude-sonnet
```

Each combo supports one of three strategies:

- `Fallback` — try models in order and move to the next model after an error
- `Round Robin` — rotate models between requests
- `Fusion` — run a panel of models and use a judge model to combine the result

When creating a Fusion combo, the first selected model is the default judge. You can change the judge from the combo details screen. Renaming or deleting a combo also updates the corresponding `comboStrategies` entry in settings.

## Quota Tracker

In Quota Tracker, `All providers` loads up to 20 active accounts with no more than three concurrent requests. Each quota entry shows a progress bar, remaining percentage, used amount, and reset time. Both account and summary screens provide navigation back to the quota list and main menu.

## Troubleshooting

- If the bot does not start, confirm that `TELEGRAM_BOT_TOKEN` is present in `.env.local` and restart APIRouter.
- If authentication fails, confirm that APIRouter is running at `APIRouter_BASE_URL` and use the current Web UI password.
- If Telegram reports that the bot is using a webhook, remove the webhook before using long polling.
- If access is denied, verify that the current chat ID is included in `TELEGRAM_ALLOWED_CHAT_IDS`.
