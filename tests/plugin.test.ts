import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { OpenClawPluginApi, ProviderPlugin } from 'openclaw/plugin-sdk/plugin-entry';
import entry, { createProvider } from '../src/index.js';
import { configSchema, parseConfig } from '../src/config.js';

test('pinned OpenClaw entry registers provider, auth and static model catalog', () => {
  let provider: ProviderPlugin | undefined;
  let catalogProvider = '';
  entry.register!({ pluginConfig: {},
    registerProvider: value => { provider = value; },
    registerModelCatalogProvider: value => { catalogProvider = value.provider; },
  } as Pick<OpenClawPluginApi, 'pluginConfig' | 'registerProvider' | 'registerModelCatalogProvider'> as OpenClawPluginApi);
  assert.equal(entry.id, 'commandcode-go');
  assert.equal(provider?.id, 'commandcode');
  assert.equal(provider?.auth[0]?.id, 'api-key');
  assert.equal(typeof provider?.createStreamFn, 'function');
  assert.equal(catalogProvider, 'commandcode');
});

test('manifest and runtime config validation use the same schema', () => {
  const manifest = JSON.parse(readFileSync(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.configSchema, configSchema);
  for (const invalid of [{ apiBase: 'http://remote.test' }, { apiBase: 'https://user:secret@api.test' },
    { apiBase: 'https://api.test/path' }, { streamIdleTimeoutMs: 0 }, { models: [] }, { unknown: true }]) {
    assert.throws(() => parseConfig(invalid));
  }
  assert.equal(parseConfig({ apiBase: 'http://127.0.0.1:1234/' }).apiBase, 'http://127.0.0.1:1234');
});

test('runtime catalog uses configured model and only appears with configured auth', async () => {
  const provider = createProvider({ models: ['deepseek/deepseek-v4.1-flash'], maxOutputTokens: 8192 });
  type CatalogContext = Parameters<NonNullable<ProviderPlugin['catalog']>['run']>[0];
  const ctx = (apiKey?: string) => ({ resolveProviderApiKey: () => ({ apiKey }) }) as CatalogContext;
  assert.equal(await provider.catalog!.run(ctx()), null);
  const catalog = await provider.catalog!.run(ctx('test-key'));
  assert.ok(catalog && 'provider' in catalog);
  assert.equal(catalog.provider.models[0]?.maxTokens, 8192);
  assert.equal(catalog.provider.models[0]?.id, 'deepseek/deepseek-v4.1-flash');
});

test('configured Go model resolves before a runtime catalog has been persisted', () => {
  const provider = createProvider({ models: ['deepseek/deepseek-v4.1-flash'] });
  type ResolveContext = Parameters<NonNullable<ProviderPlugin['resolveDynamicModel']>>[0];
  const ctx = { provider: 'commandcode', modelId: 'deepseek/deepseek-v4.1-flash' } as ResolveContext;
  const model = provider.resolveDynamicModel?.(ctx);
  assert.equal(model?.id, 'deepseek/deepseek-v4.1-flash');
  assert.equal(model?.provider, 'commandcode');
  assert.equal(model?.api, 'openai-completions');
  assert.equal(provider.resolveDynamicModel?.({ ...ctx, modelId: 'not-configured' }), undefined);
});
