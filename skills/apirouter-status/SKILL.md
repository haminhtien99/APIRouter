---
name: apirouter-status
description: Show the current local APIRouter status for Codex, including configured model or combo route, provider availability, and usage totals. Use when the user asks for APIRouter or 9Router status inside Codex.
---

# APIRouter Status

Run the deterministic local status command and present its output without replacing it with generic Codex account status:

```bash
if command -v apirouter >/dev/null 2>&1; then
  apirouter status-api
elif [ -x ./apirouter ]; then
  ./apirouter status-api
else
  node cli/cli.js status-api
fi
```

Use `--period today`, `24h`, `7d`, `30d`, `60d`, or `all` only when the user requests a different usage period. This command is read-only. If the gateway is remote, explain that the local CLI-token status command requires access to that router's dashboard authentication context.
