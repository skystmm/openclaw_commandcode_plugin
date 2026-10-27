import { definePluginEntry, buildJsonPluginConfigSchema } from 'openclaw/plugin-sdk/plugin-entry';
import { createProviderApiKeyAuthMethod } from 'openclaw/plugin-sdk/provider-auth';
import { API_BASE, DEFAULT_MODEL, GO_API, PROVIDER_ID, configSchema, parseConfig } from './config.js';
import { createCommandCodeStream } from './transport.js';
export function createProvider(config, onDiagnostic, onTrace) {
    const settings = parseConfig(config);
    const ids = settings.models ?? [DEFAULT_MODEL];
    const models = ids.map(id => ({
        id, name: id, reasoning: true, input: ['text'],
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
            return model ? { ...model, provider: PROVIDER_ID, api: GO_API, baseUrl: settings.apiBase ?? API_BASE } : undefined;
        },
        // Apply even when a previously saved models.providers row selects a generic API.
        normalizeResolvedModel: ctx => {
            const baseUrl = settings.apiBase ?? API_BASE;
            return ctx.model.api === GO_API && ctx.model.baseUrl === baseUrl ? undefined : { ...ctx.model, api: GO_API, baseUrl };
        },
        catalog: { order: 'simple', run: async (ctx) => {
                const key = ctx.resolveProviderApiKey(PROVIDER_ID).apiKey;
                if (!key)
                    return null;
                return { provider: { baseUrl: settings.apiBase ?? API_BASE, api: GO_API,
                        apiKey: key, models } };
            } },
        // Both normal turns and direct/utility completions enforce the same Go wire contract.
        createStreamFn: ctx => createCommandCodeStream(settings, { workingDir: ctx.workspaceDir, onDiagnostic, onTrace, completionKind: 'turn' }),
        wrapSimpleCompletionStreamFn: ctx => createCommandCodeStream(settings, { workingDir: ctx.workspaceDir, onDiagnostic, onTrace, completionKind: 'simple' }),
    };
}
export default definePluginEntry({
    id: 'commandcode-go', name: 'Command Code Go',
    description: 'Command Code Go account models through the CLI HTTP transport',
    configSchema: () => buildJsonPluginConfigSchema(configSchema, { cacheKey: 'commandcode-go:v1', safeParse: value => {
            try {
                return { success: true, data: parseConfig(value) };
            }
            catch {
                return { success: false, error: { issues: [{ path: [], message: 'Invalid Command Code plugin config' }] } };
            }
        } }),
    register(api) {
        const settings = parseConfig(api.pluginConfig);
        api.registerProvider(createProvider(settings, diagnostic => api.logger.warn(`[commandcode-go] request_failed ${JSON.stringify(diagnostic)}`), trace => {
            const line = `[commandcode-go] trace ${JSON.stringify(trace)}`;
            if (trace.event === 'request_failed')
                api.logger.warn(line);
            else
                api.logger.info(line);
        }));
        if (settings.diagnostics)
            api.logger.info('[commandcode-go] diagnostics_ready version=0.1.3 transport=go-cli endpoint=/alpha/generate');
        api.registerModelCatalogProvider({ provider: PROVIDER_ID, kinds: ['text'],
            staticCatalog: () => (settings.models ?? [DEFAULT_MODEL]).map(model => ({
                kind: 'text', provider: PROVIDER_ID, model, label: model, source: 'static',
            })),
        });
    },
});
