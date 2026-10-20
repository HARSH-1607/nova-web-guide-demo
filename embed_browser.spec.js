#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  const viewport = process.env.EMBED_VIEWPORT || '1280,800';
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(__dirname, 'run_test_server.js')], {
    env: { ...process.env, PORT: String(port), PUBLIC_DEMO: '', RENDER: '' }, stdio: 'ignore'
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-embed-'));
  let chrome;
  let socket;
  try {
    const url = `http://127.0.0.1:${port}/embed/demo.html`;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break; } catch { /* Starting. */ }
      await sleep(100);
    }
    chrome = spawn(chromePath, [
      '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
      '--disable-gpu-sandbox', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${viewport}`, url
    ], { stdio: 'ignore' });
    let debugPort;
    for (let attempt = 0; attempt < 100; attempt++) {
      const file = path.join(profile, 'DevToolsActivePort');
      if (fs.existsSync(file)) { debugPort = Number(fs.readFileSync(file, 'utf8').split('\n')[0]); break; }
      await sleep(100);
    }
    assert.ok(debugPort, 'Chrome did not start');
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const page = pages.find((item) => item.type === 'page');
    assert.ok(page, 'Demo tab not found');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const done = pending.get(message.id);
      pending.delete(message.id);
      message.error ? done.reject(new Error(message.error.message)) : done.resolve(message.result);
    });
    function send(method, params) {
      const id = ++nextId;
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    }
    async function evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    }
    async function waitFor(expression, label) {
      for (let attempt = 0; attempt < 150; attempt++) {
        if (await evaluate(expression)) return;
        await sleep(100);
      }
      throw new Error(`${label} timed out`);
    }
    await waitFor('document.querySelector("iframe")?.contentDocument?.querySelector("#messages")?.textContent.includes("Nova")', 'Widget greeting');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#avatarActor").dataset.model === "RobotExpressive"', 'Rigged model');
    assert.equal(await evaluate('document.querySelector("iframe").contentDocument.querySelector("#avatarActor").dataset.renderer'), 'three');
    await evaluate('const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="show pricing";doc.querySelector("#questionForm").requestSubmit()');
    await waitFor('document.querySelector("#pricing").style.outline.includes("solid")', 'Host section highlight');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#messages").textContent.includes("sample plans")', 'Widget reply');
    await waitFor('window.scrollY > 100', 'Host page scroll');
    assert.equal(await evaluate('document.body.dataset.lastNovaStop'), 'pricing');
    await evaluate('document.querySelector("iframe").contentDocument.querySelector("#startTour").click()');
    await waitFor('document.body.dataset.lastNovaStop === "home"', 'Tour first stop');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#tourProgress").textContent.includes("1 / 4")', 'Tour progress');
    await waitFor('!document.querySelector("iframe").contentDocument.querySelector("#tourNext").disabled', 'Tour next button');
    await evaluate('document.querySelector("iframe").contentDocument.querySelector("#tourNext").click()');
    await waitFor('document.body.dataset.lastNovaStop === "features"', 'Tour second stop');
    await evaluate('document.querySelector("iframe").contentDocument.querySelector("#tourExit").click()');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#tourControls").hidden', 'Tour exit');
    if (process.env.CAPTURE_EMBED === '1') {
      console.log('Widget layout:', await evaluate('(()=>{const p=document.querySelector("iframe").contentDocument.querySelector(".panel");return {height:p.clientHeight,scrollHeight:p.scrollHeight,maxHeight:getComputedStyle(p).maxHeight}})()'));
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const output = path.join(os.tmpdir(), 'nova-embed-preview.png');
      fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
      console.log(`Embed screenshot: ${output}`);
    }
    await evaluate('window.NovaEmbed.hide()');
    assert.ok(await evaluate('document.querySelector("iframe").hidden'));
    await evaluate('window.NovaEmbed.show()');
    assert.ok(await evaluate('!document.querySelector("iframe").hidden'));
    await evaluate('document.querySelector("iframe").contentDocument.querySelector("#collapse").click()');
    await waitFor('document.querySelector("iframe").style.width === "68px"', 'Widget minimize');
    await evaluate('document.querySelector("iframe").contentDocument.querySelector("#restore").click()');
    await waitFor('document.querySelector("iframe").style.width !== "68px"', 'Widget restore');
    console.log('Embed browser test passed: 3D model, chat, host navigation, and widget controls.');
  } finally {
    socket?.close();
    chrome?.kill();
    server.kill();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
