import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { OpenClawPluginApi, ProviderPlugin } from 'openclaw/plugin-sdk/plugin-entry';
import entry, { createProvider } from '../src/index.js';
import { configSchema, parseConfig } from '../src/config.js';
import { createApiRegistry, createLlmRuntime, type Model, type AssistantMessage } from '@openclaw/ai';
import { createAssistantMessageEventStream } from '@openclaw/ai/event-stream';

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
  assert.equal(model?.api, 'pi-messages');
  assert.equal(provider.resolveDynamicModel?.({ ...ctx, modelId: 'not-configured' }), undefined);
});

test('Go provider never publishes an OpenAI API route and normalizes legacy API config', async () => {
  const provider = createProvider({});
  type CatalogContext = Parameters<NonNullable<ProviderPlugin['catalog']>['run']>[0];
  const catalog = await provider.catalog!.run({ resolveProviderApiKey: () => ({ apiKey: 'local-test' }) } as CatalogContext);
  assert.ok(catalog && 'provider' in catalog);
  assert.equal(catalog.provider.api, 'pi-messages');
  type NormalizeContext = Parameters<NonNullable<ProviderPlugin['normalizeResolvedModel']>>[0];
  const oldModel = { id: 'deepseek/deepseek-v4.1-flash', provider: 'commandcode', api: 'openai-completions',
    baseUrl: 'https://api.commandcode.ai/provider/v1', name: 'DeepSeek', reasoning: true, input: ['text'],
    contextWindow: 131072, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const normalized = provider.normalizeResolvedModel?.({ provider: 'commandcode', modelId: oldModel.id, model: oldModel } as NormalizeContext);
  assert.equal(normalized?.api, 'pi-messages');
  assert.equal(normalized?.baseUrl, 'https://api.commandcode.ai');
  assert.equal(normalized?.maxTokens, 8192);
  assert.equal(provider.normalizeResolvedModel?.({ provider: 'commandcode', modelId: oldModel.id, model: normalized } as NormalizeContext), undefined);
  assert.equal(typeof provider.wrapSimpleCompletionStreamFn, 'function');
});

test('Go model cannot fall through to the public API when its native transport is unavailable', async () => {
  let publicRequests = 0;
  const registry = createApiRegistry();
  const publicApi = (model: Model) => {
    publicRequests++;
    const stream = createAssistantMessageEventStream();
    const error: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content: [], stopReason: 'error', timestamp: 1,
      errorMessage: "403 Your Go plan doesn't include API access.",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    stream.push({ type: 'error', reason: 'error', error });
    stream.end(error);
    return stream;
  };
  registry.registerApiProvider({ api: 'openai-completions', stream: publicApi, streamSimple: publicApi }, 'test:public-api');
  const runtime = createLlmRuntime(registry);
  const provider = createProvider({});
  type ResolveContext = Parameters<NonNullable<ProviderPlugin['resolveDynamicModel']>>[0];
  const model = provider.resolveDynamicModel!({ modelId: 'deepseek/deepseek-v4.1-flash' } as ResolveContext)!;
  const context = { messages: [{ role: 'user' as const, content: 'hi', timestamp: 1 }] };
  // Control: old metadata reaches the standard API and reproduces the reported rejection.
  const legacy = await runtime.completeSimple({ ...model, api: 'openai-completions' }, context, { apiKey: 'local-test' });
  assert.match(legacy.errorMessage!, /403 Your Go plan/);
  assert.equal(publicRequests, 1);
  let nativeError: unknown;
  try { nativeError = (await runtime.completeSimple(model, context, { apiKey: 'local-test' })).errorMessage; }
  catch (error) { nativeError = error instanceof Error ? error.message : String(error); }
  assert.match(String(nativeError), /pi-messages|provider|API/i);
  assert.doesNotMatch(String(nativeError), /403 Your Go plan/);
  assert.equal(publicRequests, 1, 'native transport absence must not cause another public API request');
});
