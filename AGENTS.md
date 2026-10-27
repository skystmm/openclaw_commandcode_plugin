# OpenClaw Command Code Go provider

Independent npm package targeting OpenClaw 2026.10.7. This standalone repository was extracted from the local DSH-adapter project. Preserve upstream attribution; do not import DSH runtime dependencies.

- Source: `src/`; public behavior tests: `tests/`. Temporary verification state belongs in ignored `.scratch/` or the system temp directory.
- Generated `dist/` is tracked to keep the repository installable; regenerate it with `npm run build` after source changes.
- Use the host SDK at `openclaw/plugin-sdk/*`; do not bundle another OpenClaw runtime.
- No automatic reading of CLI credential files. Keys come from OpenClaw auth or the documented environment variables.
- Go uses `/alpha/generate`; do not route generation through the paid Provider API or switch billing routes silently.
- Go model metadata must use the native `pi-messages` API slot. Preserve runtime normalization of legacy OpenAI config and the simple-completion hook; no built-in OpenAI transport fallback is allowed.
- Commands: `npm test` (protocol/registration/HTTP cases), `npm run typecheck`, `npm run build`, `npm run test:host`, `npm run test:agent` (native host with a saved API-key profile and local fake service), `npm pack --dry-run`. `npm run test:install` installs the built archive in a temporary directory and requires network access.
- Local issue/spec tracking: `docs/`. Live provider verification requires an explicitly supplied test credential; never log keys.
- Do not install into the user's OpenClaw configuration, commit, publish, or push without explicit authorization.
