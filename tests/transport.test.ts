import assert from 'node:assert/strict';
import test from 'node:test';
import type { Context, Model } from '@openclaw/ai';
import { createCommandCodeStream } from '../src/transport.js';

const model: Model = {
  id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek', provider: 'commandcode',
  api: 'openai-completions', baseUrl: 'https://api.commandcode.ai',
  reasoning: true, input: ['text'], contextWindow: 1048576, maxTokens: 32768,
  cost: { input: 0.16, output: 0.58, cacheRead: 0.016, cacheWrite: 0 },
};
const user = { role: 'user' as const, content: 'hello', timestamp: 1 };
function response(events: unknown[]): Response {
  return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
const finish = { type: 'finish', finishReason: 'stop', totalUsage: {
  inputTokens: 100, outputTokens: 12,
  inputTokenDetails: { cacheReadTokens: 40, cacheWriteTokens: 10 },
} };

test('Go transport posts CLI shape and completes a reasoning/tool/result round trip', async () => {
  const calls: { url: string; body: any; headers: Headers }[] = [];
  const stream = createCommandCodeStream({}, { fetch: async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return calls.length === 1 ? response([
      { type: 'reasoning-delta', text: 'inspect' },
      { type: 'tool-call', toolCallId: 'call_1', toolName: 'lookup', input: { city: '杭州' } },
      { ...finish, finishReason: 'tool-calls' },
    ]) : response([{ type: 'text-delta', text: '杭州晴' }, finish]);
  } });
  const first = await stream(model, { systemPrompt: 'help', messages: [user], tools: [
    { name: 'lookup', description: 'weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } },
  ] }, { apiKey: 'user_TEST', sessionId: 'session-one', reasoning: 'high' });
  const firstEvents = [];
  for await (const e of first) firstEvents.push(e);
  const toolTurn = await first.result();
  assert.equal(toolTurn.stopReason, 'toolUse');
  assert.deepEqual(toolTurn.content, [
    { type: 'thinking', thinking: 'inspect' },
    { type: 'toolCall', id: 'call_1', name: 'lookup', arguments: { city: '杭州' } },
  ]);
  assert.equal(firstEvents[0]?.type, 'start');
  assert.equal(firstEvents.at(-1)?.type, 'done');
  assert.equal(firstEvents.filter(e => e.type === 'done' || e.type === 'error').length, 1);
  const next = await stream(model, { messages: [user, toolTurn, {
    role: 'toolResult', toolCallId: 'call_1', toolName: 'lookup',
    content: [{ type: 'text', text: '晴' }], isError: false, timestamp: 2,
  }] }, { apiKey: 'user_TEST', sessionId: 'session-one' });
  const answer = await next.result();
  assert.equal(answer.stopReason, 'stop');
  assert.deepEqual(answer.content, [{ type: 'text', text: '杭州晴' }]);
  assert.equal(calls[0]?.url, 'https://api.commandcode.ai/alpha/generate');
  assert.equal(calls[0]?.headers.get('authorization'), 'Bearer user_TEST');
  assert.equal(calls[0]?.body.params.reasoning_effort, 'high');
  assert.equal(calls[0]?.body.params.tools[0].input_schema.type, 'object');
  assert.equal(calls[0]?.body.threadId, calls[1]?.body.threadId);
  assert.match(calls[0]?.body.threadId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(calls[1]?.body.params.messages[1].content[0], { type: 'reasoning', text: 'inspect' });
  assert.equal(calls[1]?.body.params.messages[2].content[0].output.value, '晴');
  assert.equal(answer.usage.input, 50);
  assert.equal(answer.usage.cacheRead, 40);
  assert.equal(answer.usage.cacheWrite, 10);
  assert.equal(answer.usage.totalTokens, 112);
});

test('unsupported images and missing keys fail before network access', async () => {
  let requests = 0;
  const stream = createCommandCodeStream({}, { fetch: async () => { requests++; return response([]); } });
  const missing = await stream(model, { messages: [user] }, { apiKey: '' });
  assert.equal((await missing.result()).stopReason, 'error');
  const image = await stream(model, { messages: [{ role: 'user', timestamp: 1,
    content: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }],
  }] }, { apiKey: 'user_TEST' });
  assert.match((await image.result()).errorMessage!, /image/i);
  assert.equal(requests, 0);
});

test('quota errors in a successful HTTP stream fail without replay or leaking credentials', async () => {
  let requests = 0;
  const stream = createCommandCodeStream({}, { fetch: async () => {
    requests++;
    return response([{ type: 'error', error: { code: 'MODEL_NOT_IN_PLAN', message: 'denied user_TEST' } }]);
  } });
  const events = await stream(model, { messages: [user] }, { apiKey: 'user_TEST' });
  const all = [];
  for await (const e of events) all.push(e);
  const final = await events.result();
  assert.equal(final.stopReason, 'error');
  assert.match(final.errorMessage!, /MODEL_NOT_IN_PLAN/);
  assert.doesNotMatch(final.errorMessage!, /user_TEST/);
  assert.equal(requests, 1);
  assert.equal(all.filter(e => e.type === 'error').length, 1);
  assert.equal(all.filter(e => e.type === 'done').length, 0);
});

test('truncated streams cannot be reported as success', async () => {
  const stream = createCommandCodeStream({}, { fetch: async () => response([{ type: 'text-delta', text: 'partial' }]) });
  const events = await stream(model, { messages: [user] }, { apiKey: 'user_TEST' });
  const final = await events.result();
  assert.equal(final.stopReason, 'error');
  assert.match(final.errorMessage!, /finish/i);
});

test('HTTP permission errors preserve category without exposing the upstream body', async () => {
  const stream = createCommandCodeStream({}, { fetch: async () => new Response(JSON.stringify({
    error: { code: 'MODEL_NOT_IN_PLAN', message: 'user_TEST cannot use that model' },
  }), { status: 403 }) });
  const final = await (await stream(model, { messages: [user] }, { apiKey: 'user_TEST' })).result();
  assert.equal(final.stopReason, 'error');
  assert.match(final.errorMessage!, /MODEL_NOT_IN_PLAN/);
  assert.doesNotMatch(final.errorMessage!, /user_TEST/);
});

test('auth rejection diagnostics retain HTTP status and credential source without exposing secrets', async () => {
  for (const [status, code] of [[401, 'AUTH_REJECTED'], [403, 'PERMISSION_REJECTED']] as const) {
    const diagnostics: unknown[] = [];
    const stream = createCommandCodeStream({}, {
      onDiagnostic: diagnostic => diagnostics.push(diagnostic),
      fetch: async () => new Response(JSON.stringify({ error: { message: 'private upstream body user_TEST' } }), { status }),
    });
    const final = await (await stream(model, { messages: [user] }, { apiKey: 'user_TEST' })).result();
    assert.equal(final.errorCode, code);
    assert.deepEqual(diagnostics, [{ stage: 'http', credentialSource: 'runtime', httpStatus: status, code }]);
    assert.doesNotMatch(JSON.stringify(diagnostics) + final.errorMessage, /user_TEST|private upstream body/);
  }
});

test('missing credentials are distinguished from upstream authentication rejection', async () => {
  const diagnostics: unknown[] = [];
  let requests = 0;
  const stream = createCommandCodeStream({}, { onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    fetch: async () => { requests++; return response([]); } });
  const final = await (await stream(model, { messages: [user] }, { apiKey: '' })).result();
  assert.equal(final.errorCode, 'MISSING_CREDENTIAL');
  assert.deepEqual(diagnostics, [{ stage: 'credentials', credentialSource: 'missing', code: 'MISSING_CREDENTIAL' }]);
  assert.equal(requests, 0);
});

test('SSE parsing survives split UTF-8 bytes, CRLF and multiline data', async () => {
  const bytes = new TextEncoder().encode(': keepalive\r\n\r\ndata: {"type":"text-delta",\r\ndata: "text":"杭州"}\r\n\r\n'
    + `data: ${JSON.stringify(finish)}\r\n\r\n`);
  const stream = createCommandCodeStream({}, { fetch: async () => new Response(new ReadableStream({
    start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); },
  })) });
  const final = await (await stream(model, { messages: [user] }, { apiKey: 'user_TEST' })).result();
  assert.equal(final.stopReason, 'stop');
  assert.deepEqual(final.content, [{ type: 'text', text: '杭州' }]);
});

test('caller cancellation terminates a stalled body and settles result()', async () => {
  let cancelled = false;
  const stream = createCommandCodeStream({}, { fetch: async () => new Response(new ReadableStream({
    cancel() { cancelled = true; },
  })) });
  const abort = new AbortController();
  const events = await stream(model, { messages: [user] }, { apiKey: 'user_TEST', signal: abort.signal });
  abort.abort();
  const final = await events.result();
  assert.equal(final.stopReason, 'aborted');
  assert.equal(cancelled, true);
});

test('request and idle deadlines terminate even when the transport does not cooperate', async () => {
  const stuckFetch = createCommandCodeStream({ requestTimeoutMs: 15 }, { fetch: () => new Promise(() => {}) });
  const first = await (await stuckFetch(model, { messages: [user] }, { apiKey: 'user_TEST' })).result();
  assert.equal(first.stopReason, 'error');
  assert.match(first.errorMessage!, /request timeout/);
  const idle = createCommandCodeStream({ streamIdleTimeoutMs: 15 }, { fetch: async () => new Response(new ReadableStream()) });
  const second = await (await idle(model, { messages: [user] }, { apiKey: 'user_TEST' })).result();
  assert.equal(second.stopReason, 'error');
  assert.match(second.errorMessage!, /idle timeout/);
});

test('ending iteration cancels the underlying request', async () => {
  let requestSignal: AbortSignal | undefined;
  const stream = createCommandCodeStream({}, { fetch: async (_url, init) => {
    requestSignal = init?.signal ?? undefined;
    return new Response(new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode('data: {"type":"text-delta","text":"partial"}\n\n'));
    } }));
  } });
  const events = await stream(model, { messages: [user] }, { apiKey: 'user_TEST' });
  for await (const event of events) { if (event.type === 'text_delta') break; }
  assert.equal((await events.result()).stopReason, 'aborted');
  assert.equal(requestSignal?.aborted, true);
});

test('malformed and duplicate tool calls fail instead of being repaired into executable calls', async () => {
  for (const events of [
    [{ type: 'tool-call', toolName: 'lookup', input: {} }],
    [{ type: 'tool-call', toolCallId: 'id', toolName: 'lookup', input: '{broken' }],
    [{ type: 'tool-call', toolCallId: 'id', toolName: 'lookup', input: {} },
      { type: 'tool-call', toolCallId: 'id', toolName: 'lookup', input: {} }],
  ]) {
    const stream = createCommandCodeStream({}, { fetch: async () => response([...events, finish]) });
    const final = await (await stream(model, { messages: [user] }, { apiKey: 'user_TEST' })).result();
    assert.equal(final.stopReason, 'error');
  }
});

test('unpaired calls are removed and long tool IDs remain paired on replay', async () => {
  const long = 'call_'.repeat(30);
  let body: any;
  const stream = createCommandCodeStream({}, { fetch: async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return response([{ type: 'text-delta', text: 'ok' }, finish]);
  } });
  const assistant = { role: 'assistant' as const, content: [
    { type: 'toolCall' as const, id: long, name: 'lookup', arguments: {} },
    { type: 'toolCall' as const, id: 'orphan', name: 'lookup', arguments: {} },
  ], api: model.api, provider: model.provider, model: model.id, stopReason: 'toolUse' as const,
  timestamp: 1, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const context: Context = { messages: [assistant, {
    role: 'toolResult', toolCallId: long, toolName: 'lookup', isError: false, timestamp: 2,
    content: [{ type: 'text', text: 'done' }],
  }] };
  await (await stream(model, context, { apiKey: 'user_TEST' })).result();
  const [call, result] = body.params.messages;
  assert.equal(call.content.length, 1);
  assert.equal(call.content[0].toolCallId, result.content[0].toolCallId);
  assert.ok(call.content[0].toolCallId.length <= 64);
});
