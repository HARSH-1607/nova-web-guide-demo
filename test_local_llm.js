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

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* Starting up. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start.');
}

async function main() {
  let observedChat = null;
  let hasModels = true;
  const mock = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') {
      response.end(JSON.stringify({ models: hasModels ? [{ name: 'test-model:latest' }] : [] }));
    } else if (request.url === '/api/chat') {
      let body = '';
      for await (const chunk of request) body += chunk;
      observedChat = JSON.parse(body);
      response.end(JSON.stringify({ message: { role: 'assistant', content: 'I can show you the features.' } }));
    } else {
      response.writeHead(404).end('{}');
    }
  });
  const mockPort = await listen(mock);
  const serverPort = await reservePort();
  const server = spawn(process.execPath, [path.join(__dirname, 'run_test_server.js')], {
    env: { ...process.env, PORT: String(serverPort), OLLAMA_BASE_URL: `http://127.0.0.1:${mockPort}`, ELEVENLABS_API_KEY: '' },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${serverPort}`;
  try {
    await waitForServer(`${base}/index.html`);
    const models = await (await fetch(`${base}/api/llm/models`)).json();
    assert.deepEqual(models.models, ['test-model:latest']);
    const chatResponse = await fetch(`${base}/api/llm/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What can you do?', model: 'test-model:latest', history: [] })
    });
    assert.equal(chatResponse.status, 200);
    assert.equal((await chatResponse.json()).reply, 'I can show you the features.');
    assert.equal(observedChat.stream, false);
    assert.equal(observedChat.messages.at(-1).content, 'What can you do?');
    assert.equal(observedChat.messages[0].role, 'system');
    const invalid = await fetch(`${base}/api/llm/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello', model: 'not-installed', history: [] })
    });
    assert.equal(invalid.status, 400);
    const foreign = await fetch(`${base}/api/llm/models`, { headers: { Origin: 'https://example.org' } });
    assert.equal(foreign.status, 403);
    hasModels = false;
    const empty = await fetch(`${base}/api/llm/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello', history: [] })
    });
    assert.equal(empty.status, 503);
    await new Promise((resolve) => mock.close(resolve));
    const offline = await fetch(`${base}/api/llm/models`);
    assert.equal(offline.status, 503);
    console.log('Local LLM integration tests passed.');
  } finally {
    server.kill();
    if (mock.listening) await new Promise((resolve) => mock.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
