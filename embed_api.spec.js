#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function port() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}

async function main() {
  const mockPort = await port();
  const sitePort = await port();
  let observed;
  const mock = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    observed = JSON.parse(Buffer.concat(chunks).toString());
    if (request.url === '/v1/audio/speech') {
      response.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      response.end(Buffer.from('fake-mp3'));
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        reply: 'The pricing section explains the plans.', target: observed.input.at(-1).content === 'unknown target' ? 'admin' : 'pricing'
      }) }] }] }));
    }
  });
  await new Promise((resolve) => mock.listen(mockPort, '127.0.0.1', resolve));
  const child = spawn(process.execPath, [path.join(__dirname, 'run_test_server.js')], {
    env: { ...process.env, NODE_ENV: 'test', PORT: String(sitePort), PUBLIC_DEMO: 'true',
      DEMO_PASSWORD: 'embed-api-test-password', EMBED_AI_ENABLED: 'true', OPENAI_API_KEY: 'test-key',
      ONLINE_REQUEST_LIMIT: '4', ELEVENLABS_API_KEY: '', EMBED_ELEVENLABS_VOICE_ID: '',
      OPENAI_TEST_API_URL: `http://127.0.0.1:${mockPort}/v1/responses`,
      OPENAI_TEST_SPEECH_URL: `http://127.0.0.1:${mockPort}/v1/audio/speech` },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${sitePort}`;
  const origin = 'https://independent.example';
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { ready = (await fetch(`${base}/healthz`)).ok; } catch { /* Starting. */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Server did not start');
    const status = await fetch(`${base}/api/embed/status`, { headers: { Origin: origin } });
    assert.equal(status.status, 200);
    assert.equal(status.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await status.json(), { chat: true, naturalVoice: true });
    const preflight = await fetch(`${base}/api/embed/chat`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'Content-Type');
    const chatBody = { message: 'Can you explain the plans?', history: [], site: { title: 'Sample Shop', description: 'A shop.' },
      personality: { name: 'Dork', tone: 'friendly', instructions: 'Be cheerful.' },
      targets: [{ key: 'pricing', label: 'Pricing', description: 'Sample plans.' }] };
    const chat = await fetch(`${base}/api/embed/chat`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(chatBody) });
    assert.equal(chat.status, 200);
    assert.deepEqual(await chat.json(), { reply: 'The pricing section explains the plans.', target: 'pricing' });
    assert.ok(observed.instructions.includes('Sample Shop'));
    assert.ok(observed.instructions.includes('Be cheerful'));
    assert.equal(observed.store, false);
    assert.equal(observed.text.format.type, 'json_schema');
    const invalid = await fetch(`${base}/api/embed/chat`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...chatBody, message: '' }) });
    assert.equal(invalid.status, 400);
    const unlisted = await fetch(`${base}/api/embed/chat`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...chatBody, message: 'unknown target' }) });
    assert.equal((await unlisted.json()).target, null, 'Unlisted destinations must not navigate the host page');
    const voice = await fetch(`${base}/api/embed/speech`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hello!' }) });
    assert.equal(voice.status, 200);
    assert.equal((await voice.json()).audioBase64, Buffer.from('fake-mp3').toString('base64'));
    assert.equal(observed.voice, 'coral');
    assert.equal((await fetch(`${base}/api/online/status`)).status, 401, 'Private API became public');
    assert.equal((await fetch(`${base}/api/embed/chat`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(chatBody) })).status, 200);
    assert.equal((await fetch(`${base}/api/embed/chat`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(chatBody) })).status, 429);
    console.log('Public embed AI, voice, CORS, quota, and private API tests passed.');
  } finally {
    child.kill();
    await new Promise((resolve) => mock.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
