import type { StreamFn } from '@openclaw/ai';
import { type PluginConfig } from './config.js';
type Dependencies = {
    fetch?: typeof fetch;
    workingDir?: string;
};
export declare function createCommandCodeStream(rawConfig?: PluginConfig, deps?: Dependencies): StreamFn;
export {};
