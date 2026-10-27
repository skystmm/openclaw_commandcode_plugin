import { createHash } from 'node:crypto';
import { createAssistantMessageEventStream } from '@openclaw/ai/event-stream';
import { API_BASE, CLI_VERSION, parseConfig } from './config.js';
import { buildBody, stringifyBody, CommandCodeError } from './wire.js';
const record = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const count = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
// Provider text can contain credentials or prompt fragments. Expose known categories only.
function providerError(value, status) {
    const outer = record(value);
    const detail = record(outer.error ?? outer);
    const code = String(detail.code ?? detail.type ?? '');
    const text = `${code} ${String(detail.message ?? outer.message ?? value)}`.toLowerCase().replaceAll('_', ' ');
    const categories = [
        ['MODEL_NOT_IN_PLAN', /model not in plan/, 'Model is not included in this account plan.'],
        ['INSUFFICIENT_CREDITS', /insufficient credits|premium credits exhausted/, 'Command Code credits exhausted.'],
        ['RATE_LIMITED', /rate limit|usage limit|window.*exceed|throttl/, 'Command Code usage limit reached; wait for the window to reset.'],
        ['CONTEXT_LENGTH_EXCEEDED', /context.*(length|window)|prompt is too long/, 'Command Code context window exceeded.'],
        ['ZDR_UNAVAILABLE', /cmd zdr no providers/, 'No ZDR upstream is available for this model.'],
        ['UPGRADE_REQUIRED', /upgrade required/, 'Command Code rejected this route for the account plan.'],
        ['AUTH_REJECTED', /invalid api key|authentication failed|unauthorized|invalid token/, 'Command Code rejected the supplied credential.'],
    ];
    const match = categories.find(([, pattern]) => pattern.test(text));
    if (match)
        return new CommandCodeError(`${match[0]}: ${match[2]}`, match[0]);
    if (status === 401)
        return new CommandCodeError('Command Code rejected the credential (HTTP 401).', 'AUTH_REJECTED');
    if (status === 403)
        return new CommandCodeError('Command Code refused this request (HTTP 403); permission or route access may be restricted.', 'PERMISSION_REJECTED');
    if (status === 429)
        return new CommandCodeError('RATE_LIMITED: Command Code usage limit reached.', 'RATE_LIMITED');
    return new CommandCodeError(`Command Code ${status ? `HTTP ${status}` : 'stream'} error. Inspect the account in Studio.`, status ? 'HTTP_ERROR' : 'STREAM_ERROR');
}
function bounded(work, signal, timeoutMs, label) {
    return new Promise((resolve, reject) => {
        let timer;
        const abort = () => { cleanup(); reject(signal.reason ?? new CommandCodeError('Aborted')); };
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
        timer = setTimeout(() => { cleanup(); reject(new CommandCodeError(label)); }, timeoutMs);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted)
            abort();
        work.then(v => { cleanup(); resolve(v); }, e => { cleanup(); reject(e); });
    });
}
async function* readEvents(body, signal, idleMs) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let data = [];
    let frameSize = 0;
    const parseLine = (line) => {
        if (line === '') {
            if (!data.length)
                return;
            const value = data.join('\n');
            data = [];
            frameSize = 0;
            if (value === '[DONE]')
                return;
            try {
                return JSON.parse(value);
            }
            catch {
                throw new CommandCodeError('Invalid Command Code SSE JSON');
            }
        }
        if (line.startsWith('data:')) {
            const part = line.slice(5).replace(/^ /, '');
            frameSize += part.length;
            if (frameSize > 2 * 1024 * 1024)
                throw new CommandCodeError('Command Code SSE event exceeds 2 MiB');
            data.push(part);
        }
    };
    try {
        while (true) {
            const chunk = await bounded(reader.read(), signal, idleMs, 'Command Code stream idle timeout');
            buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
            if (buffer.length > 2 * 1024 * 1024)
                throw new CommandCodeError('Command Code SSE buffer exceeds 2 MiB');
            let index;
            while ((index = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, index).replace(/\r$/, '');
                buffer = buffer.slice(index + 1);
                const event = parseLine(line);
                if (event !== undefined)
                    yield event;
            }
            if (chunk.done) {
                if (buffer) {
                    const event = parseLine(buffer.replace(/\r$/, ''));
                    if (event !== undefined)
                        yield event;
                }
                const event = parseLine('');
                if (event !== undefined)
                    yield event;
                break;
            }
        }
    }
    finally {
        void reader.cancel().catch(() => { });
        reader.releaseLock();
    }
}
function outputMessage(model) {
    return { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
        stopReason: 'stop', timestamp: Date.now(), usage: {
            input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        } };
}
export function createCommandCodeStream(rawConfig = {}, deps = {}) {
    const config = parseConfig(rawConfig);
    return (model, context, options = {}) => {
        const stream = createAssistantMessageEventStream();
        const controller = new AbortController();
        const abort = () => controller.abort(options.signal?.reason ?? new CommandCodeError('Aborted'));
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted)
            abort();
        const message = outputMessage(model);
        let stage = 'credentials';
        let credentialSource = 'missing';
        let httpStatus;
        const emit = (event) => stream.push(event);
        let active;
        const close = () => {
            if (!active)
                return;
            const block = message.content[active.index];
            if (block.type === 'text')
                emit({ type: 'text_end', contentIndex: active.index, content: block.text, partial: message });
            if (block.type === 'thinking')
                emit({ type: 'thinking_end', contentIndex: active.index, content: block.thinking, partial: message });
            active = undefined;
        };
        void (async () => {
            emit({ type: 'start', partial: message });
            try {
                controller.signal.throwIfAborted();
                const key = options.apiKey ?? process.env.COMMANDCODE_API_KEY ?? process.env.COMMAND_CODE_API_KEY;
                if (!key?.trim())
                    throw new CommandCodeError('Missing Command Code API key', 'MISSING_CREDENTIAL');
                credentialSource = options.apiKey !== undefined ? 'runtime' : process.env.COMMANDCODE_API_KEY !== undefined
                    ? 'COMMANDCODE_API_KEY' : 'COMMAND_CODE_API_KEY';
                if (/[\r\n]/.test(key))
                    throw new CommandCodeError('Invalid Command Code API key', 'INVALID_CREDENTIAL');
                stage = 'prepare';
                const requestMs = options.timeoutMs ?? config.requestTimeoutMs ?? 300000;
                if (!Number.isSafeInteger(requestMs) || requestMs <= 0 || requestMs > 3600000)
                    throw new CommandCodeError('Invalid Command Code request timeout');
                const startedAt = Date.now();
                const remaining = () => Math.max(1, requestMs - (Date.now() - startedAt));
                const body = buildBody(model, context, options, config, deps.workingDir);
                const patched = options.onPayload ? await bounded(Promise.resolve(options.onPayload(body, model)), controller.signal, remaining(), 'Command Code payload preparation timeout') : undefined;
                controller.signal.throwIfAborted();
                const workingDir = deps.workingDir ?? process.cwd();
                stage = 'connect';
                const response = await bounded((deps.fetch ?? fetch)(`${config.apiBase ?? API_BASE}/alpha/generate`, {
                    method: 'POST', redirect: 'error', signal: controller.signal,
                    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'Accept-Encoding': 'identity',
                        Authorization: `Bearer ${key}`, 'x-command-code-version': CLI_VERSION, 'x-cli-environment': 'production',
                        'x-project-slug': createHash('sha256').update(workingDir).digest('hex').slice(0, 16),
                        'x-taste-learning': 'false', 'x-co-flag': 'false', ...(config.zdr ? { 'x-cmd-zdr': '1' } : {}) },
                    body: stringifyBody(patched ?? body),
                }), controller.signal, remaining(), 'Command Code request timeout');
                stage = 'http';
                httpStatus = response.status;
                if (options.onResponse)
                    await bounded(Promise.resolve(options.onResponse({ status: response.status,
                        headers: Object.fromEntries(response.headers) }, model)), controller.signal, remaining(), 'Command Code response callback timeout');
                if (!response.ok) {
                    // Error responses are bounded too; never attach their raw body to diagnostics.
                    let detail;
                    if (response.body) {
                        const reader = response.body.getReader();
                        try {
                            let text = '';
                            const deadline = Date.now() + Math.min(10000, remaining());
                            while (text.length <= 65536) {
                                if (Date.now() >= deadline)
                                    throw new CommandCodeError('Command Code error response timeout');
                                const part = await bounded(reader.read(), controller.signal, Math.max(1, deadline - Date.now()), 'Command Code error response timeout');
                                if (part.done)
                                    break;
                                text += new TextDecoder().decode(part.value.subarray(0, 65537 - text.length));
                            }
                            try {
                                detail = JSON.parse(text.slice(0, 65536));
                            }
                            catch {
                                detail = text.slice(0, 65536);
                            }
                        }
                        finally {
                            void reader.cancel().catch(() => { });
                            reader.releaseLock();
                        }
                    }
                    throw providerError(detail, response.status);
                }
                if (!response.body)
                    throw new CommandCodeError('Command Code returned no response stream');
                stage = 'stream';
                let finished = false;
                let cacheWrite = 0;
                const seenCalls = new Set();
                for await (const raw of readEvents(response.body, controller.signal, config.streamIdleTimeoutMs ?? 300000)) {
                    controller.signal.throwIfAborted();
                    const e = record(raw);
                    if (e.type === 'error')
                        throw providerError(e);
                    if (e.type === 'text-delta' || e.type === 'reasoning-delta') {
                        if (typeof e.text !== 'string')
                            throw new CommandCodeError('Invalid Command Code text delta');
                        const type = e.type === 'text-delta' ? 'text' : 'thinking';
                        if (active?.type !== type) {
                            close();
                            active = { type, index: message.content.length };
                            message.content.push(type === 'text' ? { type, text: '' } : { type, thinking: '' });
                            emit({ type: type === 'text' ? 'text_start' : 'thinking_start', contentIndex: active.index, partial: message });
                        }
                        const block = message.content[active.index];
                        if (block.type === 'text') {
                            block.text += e.text;
                            emit({ type: 'text_delta', contentIndex: active.index, delta: e.text });
                        }
                        if (block.type === 'thinking') {
                            block.thinking += e.text;
                            emit({ type: 'thinking_delta', contentIndex: active.index, delta: e.text, partial: message });
                        }
                    }
                    else if (e.type === 'reasoning-end' || e.type === 'reasoning-start')
                        close();
                    else if (e.type === 'tool-call') {
                        close();
                        if (typeof e.toolCallId !== 'string' || !e.toolCallId || typeof e.toolName !== 'string' || !e.toolName) {
                            throw new CommandCodeError('Invalid Command Code tool call identity');
                        }
                        if (seenCalls.has(e.toolCallId))
                            throw new CommandCodeError('Duplicate Command Code tool call');
                        seenCalls.add(e.toolCallId);
                        const args = e.input ?? e.args ?? e.arguments ?? {};
                        if (!args || typeof args !== 'object' || Array.isArray(args))
                            throw new CommandCodeError('Invalid Command Code tool arguments');
                        const toolCall = { type: 'toolCall', id: e.toolCallId, name: e.toolName, arguments: args };
                        const contentIndex = message.content.length;
                        message.content.push(toolCall);
                        emit({ type: 'toolcall_start', contentIndex, partial: message });
                        emit({ type: 'toolcall_delta', contentIndex, delta: JSON.stringify(args), partial: message });
                        emit({ type: 'toolcall_end', contentIndex, toolCall, partial: message });
                    }
                    else if (e.type === 'cache-write-tokens')
                        cacheWrite = count(e.cacheWriteTokens);
                    else if (e.type === 'finish') {
                        close();
                        const usage = record(e.totalUsage);
                        const details = record(usage.inputTokenDetails);
                        message.usage.cacheRead = count(details.cacheReadTokens);
                        message.usage.cacheWrite = count(details.cacheWriteTokens) || cacheWrite;
                        message.usage.input = typeof details.noCacheTokens === 'number' ? count(details.noCacheTokens)
                            : Math.max(0, count(usage.inputTokens) - message.usage.cacheRead - message.usage.cacheWrite);
                        message.usage.output = count(usage.outputTokens);
                        message.usage.totalTokens = message.usage.input + message.usage.cacheRead + message.usage.cacheWrite + message.usage.output;
                        message.usage.cacheTelemetry = { state: usage.inputTokenDetails ? 'available' : 'unavailable' };
                        const rates = model.cost;
                        const costs = message.usage.cost;
                        costs.input = message.usage.input * rates.input / 1e6;
                        costs.output = message.usage.output * rates.output / 1e6;
                        costs.cacheRead = message.usage.cacheRead * rates.cacheRead / 1e6;
                        costs.cacheWrite = message.usage.cacheWrite * rates.cacheWrite / 1e6;
                        costs.total = costs.input + costs.output + costs.cacheRead + costs.cacheWrite;
                        const reason = String(e.finishReason ?? '');
                        message.stopReason = ['length', 'max_tokens'].includes(reason) ? 'length'
                            : ['tool-calls', 'tool_calls', 'tool_use'].includes(reason) || seenCalls.size ? 'toolUse' : 'stop';
                        if (!['stop', 'end-turn', 'end_turn', 'length', 'max_tokens', 'tool-calls', 'tool_calls', 'tool_use'].includes(reason)) {
                            throw new CommandCodeError('Unsupported Command Code finish reason');
                        }
                        if (!seenCalls.size && !message.content.some(b => b.type === 'text' && b.text.trim())) {
                            throw new CommandCodeError('Command Code finished without answer text or tool calls');
                        }
                        finished = true;
                        break;
                    }
                }
                if (!finished)
                    throw new CommandCodeError('Command Code stream ended before finish');
                controller.signal.throwIfAborted();
                emit({ type: 'done', reason: message.stopReason, message });
            }
            catch (error) {
                message.stopReason = options.signal?.aborted || controller.signal.aborted ? 'aborted' : 'error';
                // Only our own safe errors are surfaced. Network causes may contain URLs/credentials.
                message.errorMessage = message.stopReason === 'aborted' ? 'Command Code request aborted'
                    : error instanceof CommandCodeError ? error.message : 'Command Code request failed (network or transport error)';
                const code = message.stopReason === 'aborted' ? 'ABORTED'
                    : error instanceof CommandCodeError ? error.code ?? 'REQUEST_FAILED' : 'TRANSPORT_ERROR';
                message.errorCode = code;
                if (message.stopReason !== 'aborted') {
                    try {
                        deps.onDiagnostic?.({ stage, credentialSource, ...(httpStatus !== undefined ? { httpStatus } : {}), code });
                    }
                    catch { /* Diagnostics must never change request settlement. */ }
                }
                emit({ type: 'error', reason: message.stopReason, error: message });
            }
            finally {
                options.signal?.removeEventListener('abort', abort);
                controller.abort();
                stream.end(message);
            }
        })();
        return {
            result: () => stream.result(),
            async *[Symbol.asyncIterator]() {
                try {
                    for await (const event of stream)
                        yield event;
                }
                finally {
                    controller.abort();
                }
            },
        };
    };
}
