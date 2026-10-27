import { definePluginEntry, buildJsonPluginConfigSchema, type ProviderPlugin } from 'openclaw/plugin-sdk/plugin-entry';
import { createProviderApiKeyAuthMethod } from 'openclaw/plugin-sdk/provider-auth';
import { API_BASE, DEFAULT_MODEL, PROVIDER_ID, configSchema, parseConfig, type PluginConfig } from './config.js';
import { createCommandCodeStream } from './transport.js';

export function createProvider(config: PluginConfig): ProviderPlugin {
  const settings = parseConfig(config);
  const ids = settings.models ?? [DEFAULT_MODEL];
  const models = ids.map(id => ({
    id, name: id, reasoning: true, input: ['text' as const],
    contextWindow: settings.contextWindow ?? 131072,
    maxTokens: settings.maxOutputTokens ?? 32768,
    // No live price catalog in v0.1; zero denotes unavailable estimates, not free usage.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }));
  return {
    id: PROVIDER_ID, label: 'Command Code (Go)',
    envVars: ['COMMANDCODE_API_KEY', 'COMMAND_CODE_API_KEY'],
    auth: [createProviderApiKeyAuthMethod({
      providerId: PROVIDER_ID, methodId: 'api-key', label: 'Command Code API key',
      hint: 'Key from Command Code Studio or cmd login', optionKey: 'commandcodeApiKey',
      flagName: '--commandcode-api-key', envVar: 'COMMANDCODE_API_KEY',
      promptMessage: 'Enter your Command Code API key', defaultModel: `${PROVIDER_ID}/${ids[0]}`,
    })],
    resolveDynamicModel: ctx => {
      const model = models.find(item => item.id === ctx.modelId);
      return model ? { ...model, provider: PROVIDER_ID, api: 'openai-completions', baseUrl: settings.apiBase ?? API_BASE } : undefined;
    },
    catalog: { order: 'simple', run: async ctx => {
      const key = ctx.resolveProviderApiKey(PROVIDER_ID).apiKey;
      if (!key) return null;
      return { provider: { baseUrl: settings.apiBase ?? API_BASE, api: 'openai-completions',
        apiKey: key, models } };
    } },
    // API name is host model metadata only. Every request uses our CLI transport.
    createStreamFn: ctx => createCommandCodeStream(settings, { workingDir: ctx.workspaceDir }),
  };
}

export default definePluginEntry({
  id: 'commandcode-go', name: 'Command Code Go',
  description: 'Command Code Go account models through the CLI HTTP transport',
  configSchema: () => buildJsonPluginConfigSchema(configSchema, { cacheKey: 'commandcode-go:v1', safeParse: value => {
    try { return { success: true as const, data: parseConfig(value) }; }
    catch { return { success: false as const, error: { issues: [{ path: [], message: 'Invalid Command Code plugin config' }] } }; }
  } }),
  register(api) {
    const settings = parseConfig(api.pluginConfig);
    api.registerProvider(createProvider(settings));
    api.registerModelCatalogProvider({ provider: PROVIDER_ID, kinds: ['text'],
      staticCatalog: () => (settings.models ?? [DEFAULT_MODEL]).map(model => ({
        kind: 'text' as const, provider: PROVIDER_ID, model, label: model, source: 'static' as const,
      })),
    });
  },
});
