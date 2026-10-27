# Request diagnostics 0.1.3

Adds opt-in `diagnostics: true` lifecycle logging for normal turns and simple completions. Each call has an independent random request ID, model ID, Go endpoint and actual URL, credential source category, phase and cumulative monotonic elapsed milliseconds. HTTP responses include status; terminal events distinguish success, failure and cancellation. No headers, credentials, conversation, tool inputs, session IDs or upstream error bodies are copied into logs. The existing default failure diagnostic remains unchanged.

The URL is derived from the same validated origin as the request (no userinfo, path, query or fragment accepted in apiBase); redirects remain disabled. Custom URLs and model IDs may identify private infrastructure and can be redacted before sharing. Tracing cannot observe other providers, identify which saved credential was selected, or determine why the host chose a fallback before entering the transport.

## Verification (2026-10-27)

- `npm run check`: TypeScript, 25 tests and generated dist build passed using Node 24.22.1. Local HTTP tests require permission to listen on loopback; the sandbox-only attempt failed with EPERM and was rerun successfully with permission.
- `npm run test:host`: OpenClaw 2026.10.7 loaded the built plugin; inspect and plugin doctor passed in isolated temporary state.
- Tests cover trace disabled/enabled, correlation, actual custom HTTP URL, successful SSE, HTTP 401/403/429, connect failure, SSE rejection, cancellation, secret omission and broken log sink isolation.
- No real Go credential or paid service request was used. The complete native-agent and archive-install suites from 0.1.2 were not rerun for this logging-only patch.

## Review

Standards: schema and manifest agree, types/build pass, generated dist updated; trace callbacks cannot change request settlement. No credential or payload logging introduced.

Spec (no separate specification): logging includes the requested HTTP URL and sufficient phase/status correlation to investigate the reported runtime failures. Go transport, model selection, fallback policy and authentication behavior remain unchanged; this patch improves evidence and does not claim to resolve the service rejection.
