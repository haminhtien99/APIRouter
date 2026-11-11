# APIRouter v1.1.0

## Changes

- Update OpenCode Free model catalog, session/affinity headers, transport fingerprinting, and reversible tool-name aliases for JSON and streaming responses.
- Add optional `wreq-js` transport support and destination-platform native binding installation for the CLI.
- Improve proxy routing, cancellation, response cleanup, and provider retry handling.
- Preserve Antigravity capacity errors without silently substituting models.
- Remove the embedded Harness/Agent workspace, associated routes, launch scripts, and UI entries. Use an external agent client with APIRouter instead.
- Raise the CLI's declared minimum Node.js version to 20.9.
- Synchronize application and CLI versions to 1.1.0.

## Validation

- Production application build: passed on the final 1.1.0 source.
- Focused OpenCode/provider/proxy/dashboard Vitest checks: 204 passed, including Claude tool schemas, response header sanitization, native dependency fallback, and synthetic environment paths.
- CLI native-module packaging and router-only Node.js checks: 8 passed.
- Full Vitest run from repository root: 219 files passed, 52 failed, 11 skipped; 2,401 tests passed, 132 failed, 14 expected failures, 59 skipped. Failures include mixed Node/Vitest runner collection, missing modules, database/environment issues, and unrelated assertions. These failures have not all been compared with the previous release; this is not a fully green test run.
- Live upstream OpenCode generation was not verified during this review. Focused tests use mocked responses.
- Validation environment: Node.js 24.22.2.

## Upgrade notes

The embedded Agent dashboard is no longer available, a user-visible compatibility change. Back up local data before deployment, then rebuild and restart the application/CLI. Creating the source commit and tag does not restart a running gateway, upgrade an external OpenCode executable, or publish a package.

Native transport support depends on a compatible destination-platform binding. Validate installation on each deployment platform. Proxied native-transport requests do not silently fall back to a direct connection on proxy/network failure; proxy-scheme support depends on the native library. Translated session affinity is held in memory and may change after a restart. Upstream model availability and serving capacity are not guaranteed by this release.

See [Gemini network diagnostics](gemini-network.md) for the existing Antigravity investigation.

## Publication

The commit and annotated tag are local. After review, publish separately:

```bash
git push origin main
git push origin v1.1.0
```

Review any additional commits on `main` before pushing. No registry publication or remote release is performed automatically.
