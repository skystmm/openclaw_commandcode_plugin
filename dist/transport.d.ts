import type { StreamFn } from '@openclaw/ai';
import { type PluginConfig } from './config.js';
import { type CommandCodeFailureCode } from './wire.js';
export interface CommandCodeDiagnostic {
    stage: 'credentials' | 'prepare' | 'connect' | 'http' | 'stream';
    credentialSource: 'runtime' | 'COMMANDCODE_API_KEY' | 'COMMAND_CODE_API_KEY' | 'missing';
    httpStatus?: number;
    code: CommandCodeFailureCode;
}
type Dependencies = {
    fetch?: typeof fetch;
    workingDir?: string;
    onDiagnostic?: (diagnostic: CommandCodeDiagnostic) => void;
};
export declare function createCommandCodeStream(rawConfig?: PluginConfig, deps?: Dependencies): StreamFn;
export {};
