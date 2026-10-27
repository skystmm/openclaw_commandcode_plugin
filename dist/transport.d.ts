import type { AssistantMessage, StreamFn } from '@openclaw/ai';
import { type PluginConfig } from './config.js';
import { type CommandCodeFailureCode } from './wire.js';
export interface CommandCodeDiagnostic {
    stage: 'credentials' | 'prepare' | 'connect' | 'http' | 'stream';
    credentialSource: 'runtime' | 'COMMANDCODE_API_KEY' | 'COMMAND_CODE_API_KEY' | 'missing';
    httpStatus?: number;
    code: CommandCodeFailureCode;
}
export interface CommandCodeTrace {
    event: 'request_start' | 'response_received' | 'first_event' | 'request_succeeded' | 'request_failed' | 'request_aborted';
    requestId: string;
    provider: 'commandcode';
    model: string;
    endpoint: '/alpha/generate';
    url: string;
    transport: 'go-cli';
    completionKind: 'turn' | 'simple';
    stage: CommandCodeDiagnostic['stage'];
    credentialSource: CommandCodeDiagnostic['credentialSource'];
    elapsedMs: number;
    httpStatus?: number;
    code?: CommandCodeFailureCode;
    stopReason?: AssistantMessage['stopReason'];
}
type Dependencies = {
    fetch?: typeof fetch;
    workingDir?: string;
    completionKind?: CommandCodeTrace['completionKind'];
    onDiagnostic?: (diagnostic: CommandCodeDiagnostic) => void;
    onTrace?: (trace: CommandCodeTrace) => void;
};
export declare function createCommandCodeStream(rawConfig?: PluginConfig, deps?: Dependencies): StreamFn;
export {};
