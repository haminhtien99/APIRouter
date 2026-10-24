# Agent workspace

The Dashboard's **Agent** page embeds the full DeepSeek Harness Web UI. Harness owns sessions, workspaces, tools, approvals and model settings; APIRouter routes model requests through its existing `/v1` endpoint. The integration does not copy sessions into Basic Chat.

## Start

1. Build and start APIRouter as usual. After changing this checkout, run `npm run local:build` to update the linked `apirouter` command.
2. Install and build a DeepSeek Harness checkout with its required Node and pnpm versions. By default, the launcher looks for `../deepseek-harness` beside this checkout.
3. Configure the harness APIRouter provider, then run the following from the APIRouter checkout:

   ```bash
   npm run harness:web
   ```

4. Open `http://127.0.0.1:20228/dashboard/agent`. The page checks the runtime every 15 seconds; **Reconnect** checks immediately and reloads the embedded workspace.

Keep the harness terminal open. Ctrl+C stops the runtime started by that launcher and removes its connection record. An independently running harness is not stopped or adopted; use this launcher on its separate port to connect the Dashboard.

The launcher uses `dsh web` on loopback port **3081** and does not open another browser. **Open separately** opens the authenticated harness in a new tab when browser permissions or a larger workspace are needed.

## Provider and API key

If you already use APIRouter and `my_combo` in harness, the existing settings are reused. The launcher selects the existing `.cache/dsh-apirouter` home when it exists; otherwise it uses `harness` inside the APIRouter data directory.

For a new harness home, configure an OpenAI-compatible provider in the harness `profiles/web/cordis.patch.yml`:

```yaml
- id: llm-pi-ai
  config:
    providers:
      apirouter:
        displayName: APIRouter
        api: openai-completions
        baseURL: http://127.0.0.1:20228/v1
        apiKeyEnv: APIROUTER_API_KEY
        compat:
          thinkingFormat: deepseek
        models:
          - id: my_combo
- id: agent-default-model
  config:
    provider: apirouter
    model: my_combo
- id: ui-settings-models
  config:
    credentialOnboarding: false
```

Add the provider's API key in harness **Settings → Models → APIRouter**, or set `APIROUTER_API_KEY` in the launcher's environment. Use a key from APIRouter **Endpoint & Key**. Replace `my_combo` with an existing model or combo ID if needed; restart the harness after editing the profile. Preserve other entries in an existing patch.

## Configuration

| Variable | Purpose |
| --- | --- |
| `APIROUTER_HARNESS_DIR` | Absolute path to the built harness checkout; defaults to the adjacent `deepseek-harness`. |
| `APIROUTER_HARNESS_PORT` | Local harness listener port; defaults to `3081`. |
| `DSH_HOME` | Harness settings, credentials and sessions directory; overrides the existing-home detection. |
| `DATA_DIR` | APIRouter data directory. Use the same value for APIRouter and the harness launcher. |
| `APIROUTER_HARNESS_STATE_FILE` | Optional absolute path for the private connection record; set identically on both processes. Defaults to `harness-web.json` in the APIRouter data directory. |

For example:

```bash
APIROUTER_HARNESS_DIR=/path/to/deepseek-harness \
DSH_HOME=/path/to/harness-home \
npm run harness:web
```

The local Node 24/pnpm toolchain under harness `.cache/apirouter-toolchain/node_modules` is used when present; otherwise the launcher uses Node/pnpm on `PATH`. No packages are downloaded by this command. Harness must already be built. Extra harness arguments follow `--`, for example `npm run harness:web -- --patch apps/web/tests/pin-browse-picker.overlay.yml` for browser tests.

## Connection and access

Use the Dashboard on the same computer through `127.0.0.1` or `localhost`. This integration is for local HTTP use; it does not provide a remote reverse proxy or tunnel. APIRouter's custom server must be running so the local-client check can verify the socket address; bare `next start` is insufficient.

The connection API requires the Dashboard's existing authentication and a local client. The private runtime file contains the harness launch credential, is written with owner-only permissions on POSIX, and must not be shared or committed. Windows installations should keep the data directory within the user's private profile. API responses disable caching, and the launcher redacts launch tokens from its output.

“Harness reachable” means that the local HTTP server responded. Browsers can conceal iframe failures; if the panel remains blank, use **Open separately**, check the harness terminal, then **Reconnect**. Model errors and tool approvals appear inside the harness workspace.

After a forced shutdown, the launcher can report a stale connection record. Verify that its launcher has stopped, then remove the indicated `harness-web.json` file and start again. Stale files are not replaced automatically because another launcher may be starting at the same time.
