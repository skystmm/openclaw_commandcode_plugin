import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

test('OpenClaw embedded agent executes a tool and returns its result through the Go provider', { timeout: 180000 }, async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const state = mkdtempSync(resolve(tmpdir(), 'commandcode-go-agent-'));
  const fixture = resolve(state, 'plugin');
  mkdirSync(fixture);
  for (const name of ['dist', 'package.json', 'openclaw.plugin.json']) cpSync(resolve(root, name), resolve(fixture, name), { recursive: true });
  symlinkSync(resolve(root, 'node_modules'), resolve(fixture, 'node_modules'), 'dir');
  const requests: { params: { tools: { name: string }[]; messages: { role: string; content: { type: string; toolName?: string; output?: { type: string; value: string } }[] }[] }; threadId: string }[] = [];
  let serverError: Error | undefined;
  const server = createServer(async (req, res) => {
    try {
      let text = '';
      for await (const chunk of req) text += chunk;
      assert.equal(req.url, '/alpha/generate');
      assert.equal(req.headers.authorization, 'Bearer local-agent-test-only');
      const body = JSON.parse(text);
      requests.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const events = requests.length === 1 ? [
        { type: 'tool-call', toolCallId: 'smoke-call', toolName: 'session_status', input: {} },
        { type: 'finish', finishReason: 'tool-calls' },
      ] : [ { type: 'text-delta', text: 'GO_AGENT_SMOKE_OK' }, { type: 'finish', finishReason: 'stop' } ];
      res.end(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''));
    } catch (error) { serverError = error as Error; res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const configPath = resolve(state, 'openclaw.json');
    writeFileSync(configPath, JSON.stringify({
      plugins: { allow: ['commandcode-go'], load: { paths: [fixture] }, entries: { 'commandcode-go': { enabled: true,
        config: { apiBase: `http://127.0.0.1:${address.port}` } } } },
      agents: { defaults: { workspace: resolve(state, 'workspace'), skipBootstrap: true,
        model: { primary: 'commandcode/deepseek/deepseek-v4.1-flash' } } },
      // Test a direct tool round trip; 2026.10.7 defers schemas behind tool_search by default.
      tools: { allow: ['session_status'], toolSearch: false, codeMode: false },
    }));
    const cli = fileURLToPath(new URL('../../openclaw.mjs', import.meta.resolve('openclaw/plugin-sdk/plugin-entry')));
    const child = spawn(process.execPath, [cli, 'agent', '--local', '--session-id', randomUUID(),
      '--message', 'Check session status, then answer.', '--json', '--timeout', '60'], {
      cwd: root, env: { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`, HOME: resolve(state, 'home'),
        OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: configPath, COMMANDCODE_API_KEY: 'local-agent-test-only', NO_COLOR: '1',
        OPENCLAW_DIAGNOSTICS: '1', OPENCLAW_DIAGNOSTICS_TIMELINE_PATH: resolve(state, 'timeline.jsonl') },
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    // Native host source capture runs before inference; keep its startup budget separate.
    const timer = setTimeout(() => child.kill('SIGTERM'), 150000);
    let code: number | null;
    try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); }
    finally { clearTimeout(timer); }
    if (serverError) throw serverError;
    assert.equal(code, 0, `Agent failed; requests=${requests.length}; state=${state}\n${stderr}${stdout}`);
    assert.match(stdout, /GO_AGENT_SMOKE_OK/);
    assert.equal(requests.length, 2);
    assert.ok(requests[0]!.params.tools.some(t => t.name === 'session_status'), JSON.stringify(requests[0]!.params.tools));
    const toolResult = requests[1]!.params.messages.find(m => m.role === 'tool')?.content[0];
    assert.equal(toolResult?.type, 'tool-result');
    assert.equal(toolResult?.toolName, 'session_status');
    assert.equal(toolResult?.output?.type, 'text');
    assert.doesNotMatch(toolResult?.output?.value ?? '', /not found/i);
    assert.equal(requests[0]!.threadId, requests[1]!.threadId);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
