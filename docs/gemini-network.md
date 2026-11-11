# Gemini and Antigravity connection diagnostics

## Normal operation does not require Happ

APIRouter must not pin all Google traffic to a local VPN proxy. The previously
added `GOOGLE_PROXY_URL` setting and its routing code have been removed.

- The Google API-key provider uses the normal network path.
- Antigravity (`ag/`) also uses the normal path by default.
- Standard proxy environment variables or per-request proxy options apply only
  when explicitly configured. No local proxy is enabled automatically.
- There is no automatic model substitution. In particular,
  `ag/gemini-3.8-flash-high` remains the High model with High thinking.

APIRouter does not require Happ to be running. If the surrounding network itself
blocks Google, that network restriction is separate from APIRouter's defaults.
An explicitly configured system-wide VPN/TUN can still affect ordinary traffic.

## Gemini 3.8 Flash High: reproduced upstream error

On November 6, 2026, a native direct request to Google's daily Cloud Code API
using the configured Antigravity account returned after about 895 ms:

```json
{
  "code": 503,
  "message": "No capacity available for model gemini-3.8-flash-high on the server",
  "status": "UNAVAILABLE",
  "reason": "MODEL_CAPACITY_EXHAUSTED",
  "metadata": {
    "OVERLOADED_TOO_MANY_RETRIES_PER_REQUEST": "true"
  }
}
```

This is a sanitized excerpt of the nested upstream error, not its complete
wire representation.

Direct OAuth token refresh and authenticated model discovery both returned
HTTP 200. The High model was listed and its quota was nearly full. The shared
`gemini-3.8-flash-tiered` ID also returned the same capacity error. Switching
model IDs or forcing Happ is not an established fix for this serving-capacity
failure.

This reproduces a 503, not every historical 400. Request-detail logging was
disabled, so no stored 400 body was available to diagnose. A recurring 400 needs
the upstream status/message and a sanitized description of the request shape;
do not infer that it is the same capacity error.

The corrected gateway was also tested with all explicit proxy variables unset,
on a separate local server using a private temporary database copy:

- High, text-only: one request exceeded a 25 s test deadline. A later identical
  prompt completed with HTTP 200 and `OK` in 9455 ms. The later test allowed a
  90 s header deadline only in its temporary server; no permanent timeout was
  increased.
- High, required tool call: HTTP 200 in 8499 ms.
- Control request to Gemini 3 Flash: HTTP 200 in 1191 ms.

This demonstrates successful High generation without a forced Happ proxy, but
also intermittent upstream delay/capacity failure. It is not a long-term
stability guarantee. The model and High thinking level were not downgraded.

## Router fixes

- Ordinary traffic to Antigravity no longer takes the legacy manual public-DNS
  and raw-socket path merely because its hostname is on the MITM support list.
  That bypass is now restricted to exact known hosts actually mapped to
  loopback in the local hosts file.
- A Google error explicitly stating that its serving retries are exhausted is
  returned without another executor retry cycle. Ordinary transient errors
  retain the existing bounded retry policy.
- Client cancellation interrupts backoff and prevents additional upstream
  attempts, including when the reason is an ordinary Error or TimeoutError.
- Retried/fallback responses release their bodies before another call.
- Cancelled proxy calls are not retried through the direct route.
- HTTP 400 responses are preserved rather than retried with the same payload.

These changes reduce router-induced delay. They do not create capacity on
Google's servers or establish the cause of unrelated HTTP 400 responses.

## Rollout

The scoped test suite passed 214 tests, with 6 skipped. The production CLI build
passed. Temporary servers and credential copies were removed; the original
gateway remained healthy and was not restarted.

The corrected bundle is staged separately at `.runtime/google-network-app`;
the running `cli/app` bundle is not replaced while other clients are using it.
Stop the existing CLI before rebuilding its active bundle:

```bash
npm run local:build
./apirouter --no-browser
```

A separate build can be prepared without overwriting the active bundle:

```bash
APIROUTER_CLI_APP_DIR=/data/APIRouter/.runtime/google-network-app npm run local:build
```
