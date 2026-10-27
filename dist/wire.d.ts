import type { Context, Model, SimpleStreamOptions } from '@openclaw/ai';
import { type PluginConfig } from './config.js';
export type CommandCodeFailureCode = 'MISSING_CREDENTIAL' | 'INVALID_CREDENTIAL' | 'AUTH_REJECTED' | 'PERMISSION_REJECTED' | 'MODEL_NOT_IN_PLAN' | 'INSUFFICIENT_CREDITS' | 'RATE_LIMITED' | 'CONTEXT_LENGTH_EXCEEDED' | 'ZDR_UNAVAILABLE' | 'UPGRADE_REQUIRED' | 'HTTP_ERROR' | 'STREAM_ERROR' | 'REQUEST_FAILED' | 'TRANSPORT_ERROR' | 'ABORTED';
export declare class CommandCodeError extends Error {
    readonly code?: CommandCodeFailureCode | undefined;
    constructor(message: string, code?: CommandCodeFailureCode | undefined);
}
export declare function buildBody(model: Model, context: Context, options: SimpleStreamOptions, config: PluginConfig, workingDir?: string): {
    config: {
        workingDir: string;
        date: string;
        environment: string;
        structure: never[];
        isGitRepo: boolean;
        currentBranch: string;
        mainBranch: string;
        gitStatus: string;
        recentCommits: never[];
    };
    memory: null;
    taste: null;
    skills: null;
    permissionMode: string;
    params: {
        reasoning_effort?: string | undefined;
        model: string;
        messages: unknown[];
        tools: {
            type: string;
            name: string;
            description: string;
            input_schema: {
                type?: unknown;
            };
        }[];
        system: string | {
            type: string;
            text: string;
            cache_control: {
                type: string;
            };
        }[];
        max_tokens: number;
        temperature: number;
        stream: boolean;
    };
    threadId: string;
};
export declare function stringifyBody(body: unknown): string;
