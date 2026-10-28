# Go stream framing and runtime configuration (0.1.4)

## Evidence

On 2026-10-28, server-side diagnostics showed two independent pre-request configuration problems: agent-specific v4 selections differed from the plugin's configured v4.1 model; a legacy `plugins.entries.commandcode.enabled: false` prevented runtime hook lookup despite the `commandcode-go` plugin being enabled. An in-memory control on the server returned no provider hooks with the legacy disable entry, and returned the Go plugin with both createStreamFn and normalizeResolvedModel after removing only that entry. These facts do not imply that every 403 has this cause.

After configuration repair, real requests reached /alpha/generate and returned HTTP 200, but the plugin reported stream ended before finish. The upstream adapter's parseStreamEventLine accepts both bare JSON lines and data-prefixed SSE lines. Our parser only accepted SSE data frames, silently discarding bare JSON lines. The new public transport regressions reproduced this failure before the fix.

## Change

Parse bare JSON object/array lines as events while preserving SSE framing and multiline data. Keep bounded buffering, streaming UTF-8 decoding, CRLF and final-line handling, cancellation, and required finish semantics. Malformed JSON lines and mixed pending SSE frames fail with fixed safe errors. Provider error events retain their category without leaking their body. No credential, endpoint, model, billing route or retry change.

## Verification

- New NDJSON success and error-category tests were red on the prior parser and green after the change.
- npm run check: 27 tests, TypeScript and generated dist build passed using Node 24.22.1.
- `COMMANDCODE_TEST_CATALOG_ONLY=1 COMMANDCODE_TEST_NDJSON=1 npm run test:agent`: passed a native OpenClaw 2026.10.7 two-request tool round trip with a saved fake key, without manual provider config (63 seconds).
- `npm pack --dry-run --ignore-scripts --cache .scratch/npm-cache`: packaging passed.
- Real server updated to 0.1.4. Direct SDK -> running Gateway -> Command Code Go checks completed successfully for main and platform_worker: status ok, provider commandcode, model deepseek/deepseek-v4.1-flash, and exact fixed response markers. These were independent diagnostic sessions with delivery disabled.
- Direct SDK Gateway health returned ok. Existing Feishu session inventory contained no old v4 model selections in the inspected rows; a real Feishu user-message round trip was not sent.
- Ordinary CLI control calls experienced timeouts and update cleanup did not exit promptly; their repair is not claimed. Verification used a direct SDK client, and installation/version and running-service state were checked separately. The server's memory-backend startup failure was handled as a separately authorized operation; it is not attributed to the Go parser.
- No API key was printed or copied into this repository. Saved credentials were used by the host's normal authentication path.

## Review

Standards: parser extension stays within the existing transport; error text is fixed and includes no payload. Schema and authentication are unchanged. Generated dist is updated.

Spec (no independent specification): supports the reference adapter's bare-JSON framing alongside existing SSE and does not hide truncation or provider errors. Detailed diagnostics remain opt-in. Runtime configuration repair is documented separately from parser correctness.
