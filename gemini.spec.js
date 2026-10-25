#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function main() {
  let upstreamStatus = 200;
  let speechStatus = 200;
  let lastRequest;
  let lastSpeechRequest;
  const model = 'gemini-3.5-flash-lite';
  const wav = Buffer.alloc(48);
  wav.write('RIFF', 0, 'ascii');
  wav.write('WAVE', 8, 'ascii');
  const upstream = http.createServer(async (request, response) => {
    assert.equal(request.headers['x-goog-api-key'], 'test-gemini-key');
    let body = '';
    for await (const chunk of request) body += chunk;
    if (request.url === '/v1beta/interactions') {
      lastSpeechRequest = JSON.parse(body);
      response.writeHead(speechStatus, { 'Content-Type': 'application/json' });
      response.end(speechStatus === 200
        ? JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: wav.toString('base64') }] }] })
        : JSON.stringify({ error: { message: 'Private speech detail' } }));
      return;
    }
    assert.equal(request.url, `/v1beta/models/${model}:generateContent`);
    lastRequest = JSON.parse(body);
    response.writeHead(upstreamStatus, { 'Content-Type': 'application/json' });
    const answer = lastRequest.generationConfig.responseMimeType
      ? JSON.stringify({ reply: 'I can show you the plans.', target: 'pricing' })
      : 'I can show you the plans.';
    response.end(upstreamStatus === 200
      ? JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] } }] })
      : JSON.stringify({ error: { message: 'Do not leak upstream details.' } }));
  });
  const upstreamPort = await listen(upstream);
  const probe = http.createServer();
  const sitePort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, [path.join(__dirname, 'run_test_server.js')], {
    env: { ...process.env, NODE_ENV: 'test', PORT: String(sitePort), PUBLIC_DEMO: 'true',
      DEMO_PASSWORD: 'gemini-test-password', EMBED_AI_ENABLED: 'true',
      AI_CHAT_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-gemini-key', OPENAI_API_KEY: 'unused-openai-key',
      GEMINI_MODEL: model, GEMINI_TTS_ENABLED: 'true', PAID_VOICE_ENABLED: 'false', ONLINE_REQUEST_LIMIT: '6',
      GEMINI_TEST_API_URL: `http://127.0.0.1:${upstreamPort}/v1beta/models/${model}:generateContent`,
      GEMINI_TEST_TTS_URL: `http://127.0.0.1:${upstreamPort}/v1beta/interactions` },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${sitePort}`;
  const auth = { Authorization: `Basic ${Buffer.from('nova:gemini-test-password').toString('base64')}` };
  const embedBody = { message: 'Show me pricing', history: [], site: { title: 'Sample Shop', description: 'A shop.' },
    personality: { name: 'Dork', tone: 'friendly', instructions: 'Be clear.' },
    targets: [{ key: 'pricing', label: 'Pricing', description: 'Plans.' }] };
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { ready = (await fetch(`${base}/healthz`)).ok; } catch { /* Starting. */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Server did not start');
    const status = await (await fetch(`${base}/api/online/status`, { headers: auth })).json();
    assert.deepEqual(status, { available: true, model });
    const embedStatus = await (await fetch(`${base}/api/embed/status`)).json();
    assert.deepEqual(embedStatus, { chat: true, naturalVoice: true, voiceProvider: 'gemini' });
    const embed = await fetch(`${base}/api/embed/chat`, { method: 'POST',
      headers: { Origin: 'https://independent.example', 'Content-Type': 'application/json' }, body: JSON.stringify(embedBody) });
    assert.equal(embed.status, 200);
    assert.deepEqual(await embed.json(), { reply: 'I can show you the plans.', target: 'pricing' });
    assert.ok(lastRequest.systemInstruction.parts[0].text.includes('Sample Shop'));
    assert.equal(lastRequest.contents[0].parts[0].text, 'Show me pricing');
    assert.equal(lastRequest.generationConfig.responseMimeType, 'application/json');
    const privateChat = await fetch(`${base}/api/online/chat`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello', history: [{ role: 'assistant', content: 'Welcome' }] }) });
    assert.equal(privateChat.status, 200);
    assert.deepEqual(await privateChat.json(), { reply: 'I can show you the plans.', model });
    assert.equal(lastRequest.contents[0].role, 'model');
    assert.equal(lastRequest.contents[1].role, 'user');
    const speech = await fetch(`${base}/api/embed/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Welcome to the site.' }) });
    assert.equal(speech.status, 200);
    assert.deepEqual(await speech.json(), { audioBase64: wav.toString('base64'), audioMimeType: 'audio/wav', alignment: null });
    assert.equal(lastSpeechRequest.model, 'gemini-3.8-flash-lite-tts');
    assert.equal(lastSpeechRequest.generation_config.speech_config[0].voice, 'Orus');
    assert.equal(lastSpeechRequest.input[0].content[0].text, 'Welcome to the site.');
    speechStatus = 429;
    const speechLimited = await fetch(`${base}/api/embed/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello again.' }) });
    assert.equal(speechLimited.status, 429);
    assert.ok(!(await speechLimited.json()).error.includes('Private speech detail'));
    upstreamStatus = 429;
    const limited = await fetch(`${base}/api/embed/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(embedBody) });
    assert.equal(limited.status, 429);
    assert.ok(!(await limited.json()).error.includes('upstream details'));
    console.log('Gemini free-tier chat, baritone TTS, embed, and error tests passed.');
  } finally {
    child.kill();
    await new Promise((resolve) => upstream.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
