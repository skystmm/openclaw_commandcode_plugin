export const PROVIDER_ID = 'commandcode';
// Native message slot: never eligible for a built-in OpenAI HTTP transport.
export const GO_API = 'pi-messages';
export const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash';
export const API_BASE = 'https://api.commandcode.ai';
export const CLI_VERSION = '1.88.0';

export interface PluginConfig {
  apiBase?: string;
  models?: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  requestTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
  reasoningEffort?: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  zdr?: boolean;
}

export const configSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    apiBase: { type: 'string', default: API_BASE },
    models: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } },
    contextWindow: { type: 'integer', minimum: 1024, maximum: 10000000 },
    maxOutputTokens: { type: 'integer', minimum: 1, maximum: 131072 },
    requestTimeoutMs: { type: 'integer', minimum: 1, maximum: 3600000 },
    streamIdleTimeoutMs: { type: 'integer', minimum: 1, maximum: 3600000 },
    reasoningEffort: { type: 'string', enum: ['off', 'low', 'medium', 'high', 'xhigh', 'max'] },
    zdr: { type: 'boolean', default: false },
  },
} as const;

export function parseConfig(value: unknown): PluginConfig {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Command Code plugin config');
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!Object.hasOwn(configSchema.properties, key)) throw new Error('Unknown Command Code setting');
  }
  for (const [key, min, max] of [
    ['contextWindow', 1024, 10000000], ['maxOutputTokens', 1, 131072],
    ['requestTimeoutMs', 1, 3600000], ['streamIdleTimeoutMs', 1, 3600000],
  ] as const) {
    if (obj[key] !== undefined && (!Number.isSafeInteger(obj[key]) || Number(obj[key]) < min || Number(obj[key]) > max)) {
      throw new Error(`Invalid Command Code setting: ${key}`);
    }
  }
  if (obj.models !== undefined && (!Array.isArray(obj.models) || obj.models.length === 0
    || new Set(obj.models).size !== obj.models.length
    || obj.models.some(m => typeof m !== 'string' || !m.trim() || m !== m.trim() || /[\r\n]/.test(m)))) throw new Error('Invalid Command Code models');
  if (obj.zdr !== undefined && typeof obj.zdr !== 'boolean') throw new Error('Invalid Command Code zdr');
  if (obj.reasoningEffort !== undefined && !configSchema.properties.reasoningEffort.enum.includes(obj.reasoningEffort as never)) {
    throw new Error('Invalid Command Code reasoningEffort');
  }
  if (obj.apiBase !== undefined) {
    if (typeof obj.apiBase !== 'string') throw new Error('Invalid Command Code apiBase');
    const url = new URL(obj.apiBase);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
      throw new Error('Command Code apiBase must be an HTTPS origin (HTTP allowed only on loopback)');
    }
  }
  return { ...obj, ...(obj.apiBase ? { apiBase: new URL(String(obj.apiBase)).origin } : {}) } as PluginConfig;
}
