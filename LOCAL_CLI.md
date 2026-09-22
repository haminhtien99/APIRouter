# APIRouter CLI

APIRouter is a local-only CLI application that keeps provider, account, OAuth, model-routing, fallback, and OpenAI/Anthropic-compatible API support while binding to the loopback interface by default.

## Architecture

```text
AI tool -> http://127.0.0.1:20228/v1 -> this local process -> selected provider API
```

There is no required relay, hosted router, or intermediate 9router server. Provider traffic leaves this computer only when the selected provider itself is remote. Cloud sync and tunnels are disabled by default in 9router settings and are not needed.
APIRouter does not share processes, shutdown logic, ports, cookies, local storage, data files, IPC headers, or autostart services with 9router.

## Requirements

- Node.js 18 or newer (Node.js 20 is installed on this computer)
- npm
- Python and a project-local virtual environment are not required for the application.

## Build

```bash
npm install
npm --prefix cli install
npm run local:build
```

## Run

```bash
./apirouter
```

The local dashboard is available at `http://127.0.0.1:20228/dashboard`. Add API-key or OAuth accounts there. All configured providers are exposed through one local endpoint:

```text
http://127.0.0.1:20228/v1
```

Use the API key created in the dashboard with OpenAI-compatible tools. Anthropic-compatible clients can also use the local `/v1/messages` endpoint.

## CLI options

```bash
./apirouter --help
./apirouter --port 8080 --no-browser
./apirouter --log
```

The CLI binds to `127.0.0.1` and skips npm update checks by default. LAN exposure remains an explicit opt-in with `--host 0.0.0.0`; do not use it for a local-only setup.

## Local data

Runtime data, encrypted credentials, SQLite state, and generated API keys are stored under `~/.apirouter` by default. Keep that directory private and back it up if you depend on OAuth account sessions.

The standalone package uses its bundled `sql.js` engine. Optional native SQLite and tray dependencies can be installed inside `cli/.runtime` with:

```bash
APIROUTER_INSTALL_OPTIONAL_RUNTIME=1 npm --prefix cli run postinstall
```
