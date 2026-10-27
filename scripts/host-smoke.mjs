import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Entire host state, auth, workspace and config stay in this package's ignored scratch directory.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, '.scratch'), { recursive: true });
const state = mkdtempSync(resolve(root, '.scratch/host-smoke-'));
const configPath = resolve(state, 'openclaw.json');
writeFileSync(configPath, JSON.stringify({ plugins: { allow: ['commandcode-go'], load: { paths: [root] },
  entries: { 'commandcode-go': { enabled: true } } } }));
const cli = fileURLToPath(new URL('../../openclaw.mjs', import.meta.resolve('openclaw/plugin-sdk/plugin-entry')));
const env = { PATH: process.env.PATH ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp',
  HOME: resolve(state, 'home'), OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: configPath, NO_COLOR: '1' };
for (const args of [['plugins', 'inspect', 'commandcode-go', '--json'], ['plugins', 'doctor']]) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stderr}`);
  if (args.includes('inspect')) {
    const info = JSON.parse(result.stdout);
    assert.equal(info.plugin.status, 'loaded');
    assert.deepEqual(info.plugin.providerIds, ['commandcode']);
    assert.deepEqual(info.diagnostics, []);
    console.log('OpenClaw 2026.10.7: commandcode-go loaded; commandcode provider registered; no diagnostics.');
  } else console.log(result.stdout.trim());
}
console.log(`Isolated state: ${state}`);
