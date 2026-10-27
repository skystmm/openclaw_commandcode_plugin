// Protocol ported from Mars-Sea/dsh-commandcode-provider (MIT); see NOTICE.
import { createHash, randomUUID } from 'node:crypto';
import type { Context, Model, SimpleStreamOptions } from '@openclaw/ai';
import { DEFAULT_MODEL, type PluginConfig } from './config.js';

export class CommandCodeError extends Error {}

function threadId(sessionId?: string): string {
  if (!sessionId) return randomUUID();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return sessionId;
  const bytes = createHash('sha256').update('openclaw-commandcode/session/').update(sessionId).digest();
  bytes[6] = (bytes[6]! & 15) | 80;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString('hex', 0, 16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildBody(model: Model, context: Context, options: SimpleStreamOptions, config: PluginConfig, workingDir?: string) {
  if (options.stop?.length) throw new CommandCodeError('Command Code does not support stop sequences');
  if (options.responseFormat) throw new CommandCodeError('Command Code Go responseFormat is not supported');
  const names = new Map<string, string>();
  const results = new Set(context.messages.filter(m => m.role === 'toolResult').map(m => m.toolCallId));
  for (const m of context.messages) {
    if (m.role === 'assistant') for (const b of m.content) if (b.type === 'toolCall') names.set(b.id, b.name);
  }
  const paired = new Set([...results].filter(id => names.has(id)));
  const wireId = (id: string) => id.length <= 64 ? id : `call_${createHash('sha256').update(id).digest('hex').slice(0, 40)}`;
  const textParts = (parts: Context['messages'][number]['content']) => {
    if (typeof parts === 'string') return [{ type: 'text', text: parts }];
    return parts.map(p => {
      if (p.type !== 'text') throw new CommandCodeError('Image input is not supported by Command Code Go plugin v0.1');
      return { type: 'text', text: p.text };
    });
  };
  const messages = context.messages.flatMap((m): unknown[] => {
    if (m.role === 'user') return [{ role: 'user', content: textParts(m.content) }];
    if (m.role === 'toolResult') {
      if (!paired.has(m.toolCallId)) return [];
      const text = textParts(m.content).map(p => p.text).join('\n') || '(empty tool result)';
      return [{ role: 'tool', content: [{ type: 'tool-result', toolCallId: wireId(m.toolCallId),
        toolName: names.get(m.toolCallId), output: { type: m.isError ? 'error-text' : 'text', value: text } }] }];
    }
    const content = m.content.flatMap((b): unknown[] => {
      if (b.type === 'text') return [{ type: 'text', text: b.text }];
      if (b.type === 'thinking') return b.redacted ? [] : [{ type: 'reasoning', text: b.thinking }];
      return paired.has(b.id) ? [{ type: 'tool-call', toolCallId: wireId(b.id), toolName: b.name, input: b.arguments }] : [];
    });
    return content.length ? [{ role: 'assistant', content }] : [];
  });
  const tools = (context.tools ?? []).map(t => {
    const schema = t.parameters as { type?: unknown };
    if (!schema || typeof schema !== 'object' || schema.type !== 'object') {
      throw new CommandCodeError('Tool requires an object-root JSON schema');
    }
    return { type: 'function', name: t.name, description: t.description, input_schema: schema };
  });
  const requestedEffort = options.reasoning;
  // The default model publishes off/low/high/max, not medium/xhigh.
  const mappedEffort = model.id === DEFAULT_MODEL && requestedEffort
    ? ({ minimal: 'low', medium: 'high', xhigh: 'max' } as Record<string, string>)[requestedEffort] ?? requestedEffort
    : requestedEffort === 'minimal' ? 'low' : requestedEffort;
  const effort = config.reasoningEffort ?? mappedEffort;
  const maxTokens = Math.min(options.maxTokens ?? model.maxTokens, config.maxOutputTokens ?? 32768, 131072);
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new CommandCodeError('Invalid maxTokens');
  return {
    config: { workingDir: workingDir ?? process.cwd(), date: new Date().toISOString().slice(0, 10),
      environment: `${process.platform}-${process.arch}, Node.js ${process.version}`, structure: [],
      isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] },
    memory: null, taste: null, skills: null, permissionMode: 'standard',
    params: { model: model.id, messages, tools, system: context.systemPrompt
      ? [{ type: 'text', text: context.systemPrompt, cache_control: { type: 'ephemeral' } }] : '',
      max_tokens: maxTokens, temperature: options.temperature ?? 0.3, stream: true,
      ...(effort ? { reasoning_effort: effort } : {}) },
    threadId: threadId(options.sessionId),
  };
}

export function stringifyBody(body: unknown): string {
  return JSON.stringify(body, (_key, value: unknown) => typeof value === 'string'
    ? value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '') : value);
}
