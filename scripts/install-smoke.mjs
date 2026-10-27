import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const existingState = process.argv[2];
const state = existingState ? resolve(existingState) : mkdtempSync(resolve(tmpdir(), 'commandcode-go-package-'));
const cli = fileURLToPath(new URL('../../openclaw.mjs', import.meta.resolve('openclaw/plugin-sdk/plugin-entry')));
const env = { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`, HOME: resolve(state, 'home'),
  OPENCLAW_STATE_DIR: resolve(state, 'state'), OPENCLAW_CONFIG_PATH: resolve(state, 'state/openclaw.json'),
  npm_config_cache: resolve(state, 'npm-cache'), npm_config_fetch_retries: '0', npm_config_fetch_timeout: '30000',
  NO_COLOR: '1' };
const artifact = resolve(root, 'openclaw-commandcode-go-0.1.0.tgz');
for (const args of [
  ...existingState ? [] : [['plugins', 'install', artifact, '--force', '--accept-capabilities']],
  ['plugins', 'inspect', 'commandcode-go', '--json'],
  ['plugins', 'doctor'],
]) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8', timeout: 180000 });
  if (args.includes('doctor') && result.status === 1 && result.stdout.includes('reason=provenance-invalid')) {
    assert.equal((result.stdout.match(/^- /gm) ?? []).length, 1, result.stdout);
    console.log('Doctor reports only the expected unsigned local-source provenance warning.');
    continue;
  }
  assert.equal(result.status, 0, `${args.slice(0, 2).join(' ')} failed: ${result.stdout}\n${result.stderr}`);
  if (args.includes('inspect')) {
    const info = JSON.parse(result.stdout);
    assert.equal(info.plugin.status, 'loaded');
    assert.deepEqual(info.plugin.providerIds, ['commandcode']);
    assert.ok(info.diagnostics.every(d => d.level === 'warn' && d.message.includes('reason=provenance-invalid')),
      JSON.stringify(info.diagnostics));
    console.log('Installed archive loads commandcode provider; only the expected unsigned local-source provenance warning is permitted.');
  } else console.log(result.stdout.trim());
}
console.log(`Isolated package install state: ${state}`);
