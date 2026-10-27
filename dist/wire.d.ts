import type { Context, Model, SimpleStreamOptions } from '@openclaw/ai';
import { type PluginConfig } from './config.js';
export declare class CommandCodeError extends Error {
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
