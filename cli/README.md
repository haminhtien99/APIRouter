# APIRouter CLI

Run the local unified AI gateway:

```bash
apirouter
```

The server binds to `127.0.0.1:20228` by default and exposes:

- Dashboard: `http://127.0.0.1:20228/dashboard`
- OpenAI-compatible API: `http://127.0.0.1:20228/v1`
- Anthropic-compatible messages API: `http://127.0.0.1:20228/v1/messages`

All account credentials and routing state remain on the local computer unless the user explicitly enables an optional external feature.
