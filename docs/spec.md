# Go provider v0.1

Target OpenClaw: 2026.10.7. A separate package adapts OpenClaw messages and tools to Command Code's CLI HTTP backend using the user's Go account key. OpenClaw retains tool execution and conversation ownership.

Acceptance: native plugin registration and API-key setup; configurable selected model; text/thinking/tool streams and complete tool round trip; stable session UUID; schema validation; bounded HTTP/idle deadlines; cancellation and in-band errors produce one terminal message; key and provider response secrets do not appear in diagnostics; installable built npm package with upstream MIT notices.

Design: use `registerProvider.createStreamFn` for `/alpha/generate` only. Never fall back to another billing route. Keep a small known Go model default and allow explicit model selection; server owns model permissions. No automatic paid probes. Tests use local/mock HTTP and the pinned SDK contracts.

Non-goals for v0.1: browser sign-in, credential-file scanning, account rotation, quota dashboard, images, web search, full live catalog synchronization, publication or modifying the user's gateway setup. Unsupported image input must fail visibly instead of being silently dropped. Follow-up browser sign-in can reuse the upstream callback design after this transport is verified.

Live acceptance remains separate: actual Go account, current backend access and billing, and end-to-end gateway execution. Do not claim these from mock tests.
