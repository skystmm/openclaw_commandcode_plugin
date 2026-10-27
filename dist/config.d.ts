export declare const PROVIDER_ID = "commandcode";
export declare const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";
export declare const API_BASE = "https://api.commandcode.ai";
export declare const CLI_VERSION = "1.88.0";
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
export declare const configSchema: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly apiBase: {
            readonly type: "string";
            readonly default: "https://api.commandcode.ai";
        };
        readonly models: {
            readonly type: "array";
            readonly minItems: 1;
            readonly uniqueItems: true;
            readonly items: {
                readonly type: "string";
                readonly minLength: 1;
            };
        };
        readonly contextWindow: {
            readonly type: "integer";
            readonly minimum: 1024;
            readonly maximum: 10000000;
        };
        readonly maxOutputTokens: {
            readonly type: "integer";
            readonly minimum: 1;
            readonly maximum: 131072;
        };
        readonly requestTimeoutMs: {
            readonly type: "integer";
            readonly minimum: 1;
            readonly maximum: 3600000;
        };
        readonly streamIdleTimeoutMs: {
            readonly type: "integer";
            readonly minimum: 1;
            readonly maximum: 3600000;
        };
        readonly reasoningEffort: {
            readonly type: "string";
            readonly enum: readonly ["off", "low", "medium", "high", "xhigh", "max"];
        };
        readonly zdr: {
            readonly type: "boolean";
            readonly default: false;
        };
    };
};
export declare function parseConfig(value: unknown): PluginConfig;
