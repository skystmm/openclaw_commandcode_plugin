import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import type { Model } from '@openclaw/ai';
import { createCommandCodeStream } from '../src/transport.js';
import entry from '../src/index.js';
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
    entry.register!({ pluginConfig: { apiBase: `http://127.0.0.1:${address.port}` },
      logger: { warn: (message: string) => logs.push(message) },
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
    assert.equal(logs.length, 1);
    assert.match(logs[0]!, /^\[commandcode-go\] request_failed /);
    const diagnostic = JSON.parse(logs[0]!.slice('[commandcode-go] request_failed '.length));
    assert.deepEqual(diagnostic, { stage: 'http', credentialSource: 'runtime', httpStatus: 401, code: 'AUTH_REJECTED' });
    assert.doesNotMatch(logs.join(''), /local-private-test-key|secret|127\.0\.0\.1/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
