import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import type { Model } from '@openclaw/ai';
import { createCommandCodeStream } from '../src/transport.js';
import entry, { createProvider } from '../src/index.js';
import type { OpenClawPluginApi, ProviderPlugin } from 'openclaw/plugin-sdk/plugin-entry';

test('real HTTP transport sends Go headers and supports host payload/response callbacks', async () => {
  let received: Record<string, unknown> = {};
  let observedStatus = 0;
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    received = { path: req.url, auth: req.headers.authorization, zdr: req.headers['x-cmd-zdr'],
      version: req.headers['x-command-code-version'], body: JSON.parse(text) };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"type":"text-delta","text":"ok"}\n\ndata: {"type":"finish","finishReason":"stop"}\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const stream = createCommandCodeStream({ apiBase: `http://127.0.0.1:${address.port}`, zdr: true });
    const model: Model = { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek', api: 'openai-completions',
      provider: 'commandcode', baseUrl: 'https://ignored.invalid', reasoning: true, input: ['text'],
      maxTokens: 32768, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const final = await (await stream(model, { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] }, {
      apiKey: 'test-local-only', reasoning: 'medium',
      onPayload(payload) { (payload as { params: { temperature: number } }).params.temperature = 0.1; },
      onResponse(response) { observedStatus = response.status; },
    })).result();
    assert.equal(final.stopReason, 'stop');
    assert.equal(received.path, '/alpha/generate');
    assert.equal(received.auth, 'Bearer test-local-only');
    assert.equal(received.zdr, '1');
    assert.equal(received.version, '1.88.0');
    assert.equal(observedStatus, 200);
    const body = received.body as { params: { temperature: number; reasoning_effort: string } };
    assert.equal(body.params.temperature, 0.1);
    assert.equal(body.params.reasoning_effort, 'high');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('registered provider logs safe upstream rejection details before the host masks the error', async () => {
  const logs: string[] = [];
  const server = createServer((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'invalid_api_key', message: 'secret local-private-test-key' } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    let provider: ProviderPlugin | undefined;
    entry.register!({ pluginConfig: { apiBase: `http://127.0.0.1:${address.port}`, diagnostics: true },
      logger: { warn: (message: string) => logs.push(message), info: (message: string) => logs.push(message) },
      registerProvider: (value: ProviderPlugin) => { provider = value; }, registerModelCatalogProvider: () => {},
    } as unknown as OpenClawPluginApi);
    type ResolveContext = Parameters<NonNullable<ProviderPlugin['resolveDynamicModel']>>[0];
    const model = provider!.resolveDynamicModel!({ modelId: 'deepseek/deepseek-v4.1-flash', provider: 'commandcode' } as ResolveContext)!;
    type StreamContext = Parameters<NonNullable<ProviderPlugin['createStreamFn']>>[0];
    const stream = provider!.createStreamFn!({ model } as StreamContext)!;
    const final = await (await stream(model, { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] }, {
      apiKey: 'local-private-test-key',
    })).result();
    assert.equal(final.errorCode, 'AUTH_REJECTED');
    const failure = logs.find(line => line.startsWith('[commandcode-go] request_failed '))!;
    const diagnostic = JSON.parse(failure.slice('[commandcode-go] request_failed '.length));
    assert.deepEqual(diagnostic, { stage: 'http', credentialSource: 'runtime', httpStatus: 401, code: 'AUTH_REJECTED' });
    const traces = logs.filter(line => line.startsWith('[commandcode-go] trace '))
      .map(line => JSON.parse(line.slice('[commandcode-go] trace '.length)));
    assert.deepEqual(traces.map(t => t.event), ['request_start', 'response_received', 'request_failed']);
    assert.ok(traces.every(t => t.url === `http://127.0.0.1:${address.port}/alpha/generate`));
    assert.ok(traces.every(t => t.requestId === traces[0].requestId));
    assert.equal(traces.at(-1).httpStatus, 401);
    assert.equal(traces.at(-1).code, 'AUTH_REJECTED');
    assert.equal(traces[0].completionKind, 'turn');
    assert.ok(logs.some(line => line.includes('diagnostics_ready version=0.1.3')));
    assert.doesNotMatch(logs.join(''), /local-private-test-key|secret|Authorization|Bearer/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Go utility completions replace a standard API adapter and only call the CLI endpoint', async () => {
  const paths: string[] = [];
  let genericAdapterUsed = false;
  const server = createServer(async (req, res) => {
    paths.push(req.url!);
    if (req.url !== '/alpha/generate') {
      res.writeHead(403); res.end("Your Go plan doesn't include API access."); return;
    }
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    assert.equal(body.params.max_tokens, 64);
    assert.equal(body.params.model, 'deepseek/deepseek-v4.1-flash');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"type":"text-delta","text":"A short title"}\n\ndata: {"type":"finish","finishReason":"stop"}\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const provider = createProvider({ apiBase: `http://127.0.0.1:${address.port}` });
    type ResolveContext = Parameters<NonNullable<ProviderPlugin['resolveDynamicModel']>>[0];
    const model = provider.resolveDynamicModel!({ modelId: 'deepseek/deepseek-v4.1-flash' } as ResolveContext)!;
    type WrapperContext = Parameters<NonNullable<ProviderPlugin['wrapSimpleCompletionStreamFn']>>[0];
    const stream = provider.wrapSimpleCompletionStreamFn!({ model, provider: 'commandcode', modelId: model.id,
      streamFn: () => { genericAdapterUsed = true; throw new Error("403 Your Go plan doesn't include API access."); },
    } as WrapperContext)!;
    const answer = await (await stream(model, { messages: [{ role: 'user', content: 'title', timestamp: 1 }] },
      { apiKey: 'local-go-test', maxTokens: 64 })).result();
    assert.equal(answer.stopReason, 'stop');
    assert.deepEqual(paths, ['/alpha/generate']);
    assert.equal(genericAdapterUsed, false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
