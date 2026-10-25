#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function reservePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  const port = await reservePort();
  const child = spawn(process.execPath, [path.join(__dirname, 'run_test_server.js')], {
    env: { ...process.env, PORT: String(port), PUBLIC_DEMO: 'true', DEMO_PASSWORD: 'embed-test-password-long' },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { ready = (await fetch(`${base}/healthz`)).ok; } catch { /* Starting. */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Server did not start');
    assert.equal((await fetch(`${base}/`)).status, 401, 'Protected demo became public');
    assert.equal((await fetch(`${base}/api/online/status`)).status, 401, 'Protected API became public');
    for (const file of [
      '/embed/nova-embed.js', '/embed/frame.html', '/embed/frame.css', '/embed/frame.js', '/embed/demo.html',
      '/avatar3d.js', '/drok-avatar.js', '/vendor/three.module.js',
      '/vendor/examples/jsm/loaders/GLTFLoader.js', '/vendor/examples/jsm/utils/BufferGeometryUtils.js',
      '/vendor/examples/jsm/utils/SkeletonUtils.js', '/models/Drok_Web_Avatar.glb', '/models/Drok_Web_Avatar_Transparent.png'
    ]) {
      const response = await fetch(`${base}${file}`);
      assert.equal(response.status, 200, `${file} should be embeddable without demo credentials`);
    }
    const drok = await fetch(`${base}/models/Drok_Web_Avatar.glb`);
    assert.equal(drok.headers.get('content-type'), 'model/gltf-binary');
    const portrait = await fetch(`${base}/models/Drok_Web_Avatar_Transparent.png`);
    assert.equal(portrait.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(`${base}/embed/../run_test_server.js`)).status, 401);
    console.log('Embed asset and private-route tests passed.');
  } finally { child.kill(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
