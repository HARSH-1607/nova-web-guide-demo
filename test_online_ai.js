#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function reservePort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForServer(base) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { /* Starting up. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start.');
}

async function withServer(environment, test) {
  const port = await reservePort();
  const child = spawn(process.execPath, [path.join(__dirname, 'run_test_server.js')], {
    env: { ...process.env, PORT: String(port), AI_CHAT_PROVIDER: 'openai', ELEVENLABS_API_KEY: '', ...environment },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(base);
    await test(base);
  } finally { child.kill(); }
}

async function postChat(base, body, headers = {}) {
  return fetch(`${base}/api/online/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

function requestWithHost(base, host, origin, authorization) {
  const port = Number(new URL(base).port);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: '/api/online/status',
      headers: { Host: host, Origin: origin, Authorization: authorization } }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
}

async function main() {
  await withServer({ OPENAI_API_KEY: '', OPENAI_TEST_API_URL: '' }, async (base) => {
    const status = await (await fetch(`${base}/api/online/status`)).json();
    assert.equal(status.available, false);
    assert.equal((await postChat(base, { message: 'Hello' })).status, 503);
  });

  await withServer({ PUBLIC_DEMO: 'true', DEMO_PASSWORD: 'demo-test-pass', OPENAI_API_KEY: '' }, async (base) => {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    const unauthorized = await fetch(`${base}/`);
    assert.equal(unauthorized.status, 401);
    assert.ok(unauthorized.headers.get('www-authenticate').includes('Basic'));
    const auth = { Authorization: `Basic ${Buffer.from('nova:demo-test-pass').toString('base64')}` };
    assert.equal((await fetch(`${base}/`, { headers: auth })).status, 200);
    assert.equal((await fetch(`${base}/run_test_server.js`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${base}/models/Emma.fbx`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${base}/models/Drok_Web_Avatar.glb`, { headers: auth })).status, 200);
    assert.equal((await fetch(`${base}/api/online/status`, { headers: auth })).status, 200);
    assert.equal(await requestWithHost(base, 'demo.example', 'https://demo.example', auth.Authorization), 200);
    assert.equal(await requestWithHost(base, 'demo.example', 'https://evil.example', auth.Authorization), 403);
  });

  let observed;
  let upstreamStatus = 200;
  const mock = http.createServer(async (request, response) => {
    assert.equal(request.url, '/v1/responses');
    assert.equal(request.headers.authorization, 'Bearer test-key');
    let raw = '';
    for await (const chunk of request) raw += chunk;
    observed = JSON.parse(raw);
    response.setHeader('Content-Type', 'application/json');
    response.statusCode = upstreamStatus;
    response.end(upstreamStatus === 200
      ? JSON.stringify({ model: 'mock-model', output: [{ type: 'message', content: [{ type: 'output_text', text: 'I can show you the features.' }] }] })
      : JSON.stringify({ error: { message: 'Sensitive upstream detail' } }));
  });
  const mockPort = await listen(mock);
  try {
    await withServer({
      NODE_ENV: 'test', OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'mock-model',
      ONLINE_REQUEST_LIMIT: '2',
      OPENAI_TEST_API_URL: `http://127.0.0.1:${mockPort}/v1/responses`
    }, async (base) => {
      const status = await (await fetch(`${base}/api/online/status`)).json();
      assert.deepEqual(status, { available: true, model: 'mock-model' });
      const response = await postChat(base, {
        message: 'What can you do?', history: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }]
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { reply: 'I can show you the features.', model: 'mock-model' });
      assert.equal(observed.store, false);
      assert.equal(observed.max_output_tokens, 160);
      assert.equal(observed.input.at(-1).content, 'What can you do?');
      assert.equal(observed.input.length, 3);
      assert.ok(observed.instructions.includes('You are Dork'));
      assert.equal((await postChat(base, { message: 'x'.repeat(241) })).status, 400);
      assert.equal((await postChat(base, { message: 'Hello' }, { Origin: 'https://example.com' })).status, 403);
      upstreamStatus = 401;
      const rejected = await postChat(base, { message: 'Hello' });
      assert.equal(rejected.status, 401);
      assert.ok(!(await rejected.json()).error.includes('Sensitive upstream detail'));
      assert.equal((await postChat(base, { message: 'One more question' })).status, 429);
    });
  } finally { await new Promise((resolve) => mock.close(resolve)); }
  console.log('Online AI integration tests passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
