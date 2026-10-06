#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function withApp(env, run) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, 'run_test_server.js')], {
    env: { ...process.env, PORT: String(port), RENDER: '', PUBLIC_DEMO: '', ...env },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { ready = (await fetch(`${base}/healthz`)).ok; } catch { /* Still starting. */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'App failed to start');
    await run(base);
  } finally { child.kill(); }
}

function post(base, payload, origin) {
  return fetch(`${base}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(payload)
  });
}

const valid = {
  type: 'bug', name: 'Visitor', email: 'visitor@example.com',
  message: 'The tour button appears to be missing.', website: ''
};

async function main() {
  await withApp({ RESEND_API_KEY: '' }, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/api/contact/status`)).json(), { available: false, publicEmail: null });
    assert.equal((await post(base, valid)).status, 503);
    assert.equal((await fetch(`${base}/contact.js`)).status, 200);
  });

  let observed;
  let upstreamStatus = 200;
  const mock = http.createServer(async (request, response) => {
    assert.equal(request.url, '/emails');
    assert.equal(request.headers.authorization, 'Bearer test-key');
    let raw = '';
    for await (const chunk of request) raw += chunk;
    observed = JSON.parse(raw);
    response.writeHead(upstreamStatus, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(upstreamStatus === 200 ? { id: 'test-message-id' } : { message: 'Private upstream error' }));
  });
  const mockPort = await listen(mock);
  try {
    await withApp({ NODE_ENV: 'test', RESEND_API_KEY: 'test-key', CONTACT_TO_EMAIL: 'owner@example.com', CONTACT_PUBLIC_EMAIL: 'hello@example.com', RESEND_TEST_API_URL: `http://127.0.0.1:${mockPort}/emails` }, async (base) => {
      assert.deepEqual(await (await fetch(`${base}/api/contact/status`)).json(), { available: true, publicEmail: 'hello@example.com' });
      assert.equal((await post(base, { ...valid, message: 'short' })).status, 400);
      assert.equal((await post(base, { ...valid, email: 'bad address' })).status, 400);
      assert.equal((await post(base, { ...valid, website: 'bot' })).status, 400);
      assert.equal((await post(base, valid, 'https://evil.example')).status, 403);
      const sent = await post(base, valid);
      assert.equal(sent.status, 200);
      assert.deepEqual(await sent.json(), { sent: true });
      assert.deepEqual(observed.to, ['owner@example.com']);
      assert.equal(observed.reply_to, valid.email);
      assert.ok(observed.text.includes(valid.message));
      assert.equal(observed.subject, '[Aura] Bug report');
      upstreamStatus = 403;
      const failure = await post(base, valid);
      assert.equal(failure.status, 502);
      assert.ok(!(await failure.text()).includes('Private upstream error'));
    });
  } finally { await new Promise((resolve) => mock.close(resolve)); }
  console.log('Contact tests passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
