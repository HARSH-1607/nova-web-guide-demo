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
  let hostPort;
  do { hostPort = await freePort(); } while (hostPort === port);
  const server = spawn(process.execPath, [path.join(__dirname, 'run_test_server.js')], {
    env: { ...process.env, PORT: String(port), PUBLIC_DEMO: '', RENDER: '', OPENAI_API_KEY: 'browser-test-key' }, stdio: 'ignore'
  });
  const independentHost = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>Independent host</title><main><section id="pricing" data-nova-guide="pricing" data-nova-description="Plans on an independent origin"><h1>Pricing</h1></section><section><h2>Shipping &amp; Returns</h2><p>Delivery and returns information.</p></section></main><script>window.NovaEmbedConfig={onNavigate(key){document.body.dataset.lastNovaStop=key}}</script><script src="http://127.0.0.1:${port}/embed/nova-embed.js"></script>`);
  });
  await new Promise((resolve) => independentHost.listen(hostPort, '127.0.0.1', resolve));
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
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#avatarActor").dataset.model === "Drok"', 'Blender Drok model');
    assert.equal(await evaluate('document.querySelector("iframe").contentDocument.querySelector("#avatarActor").dataset.renderer'), 'three');
    assert.equal(await evaluate('document.querySelector("iframe").contentWindow.performance.getEntriesByType("resource").some((entry) => /RobotExpressive|robot-avatar/.test(entry.name))'), false);
    await evaluate('window.dispatchEvent(new PointerEvent("pointermove",{clientX:60,clientY:100}))');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#avatarActor").dataset.gazeSource === "host"', 'Host cursor gaze');
    await evaluate('document.querySelector("iframe").contentDocument.querySelector("#reactionToggle").click()');
    await evaluate('document.querySelector("iframe").contentDocument.querySelector("[data-gesture=nod]").click()');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#avatarActor").dataset.animation === "nod"', 'Nod animation');
    await evaluate('document.querySelector("iframe").contentDocument.querySelector("#reactionToggle").click()');
    await evaluate('document.querySelector("iframe").contentDocument.querySelector("[data-gesture=fistBump]").click()');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#avatarActor").dataset.animation === "fistBump"', 'Fist-bump animation');
    for (const [move, clip] of [['shake', 'shake'], ['think', 'thinking'], ['jump', 'jump'], ['dance', 'dance'], ['joy', 'joy'], ['wave', 'wave']]) {
      await evaluate(`document.querySelector("iframe").contentDocument.querySelector("#reactionToggle").click();document.querySelector("iframe").contentDocument.querySelector("[data-gesture=${move}]").click()`);
      await waitFor(`document.querySelector("iframe").contentDocument.querySelector("#avatarActor").dataset.animation === "${clip}"`, `${move} animation`);
    }
    if (process.env.CAPTURE_GESTURE === '1') {
      await sleep(650);
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const output = path.join(os.tmpdir(), 'nova-wave-preview.png');
      fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
      console.log(`Wave screenshot: ${output}`);
    }
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
    await evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="show me around";doc.querySelector("#questionForm").requestSubmit()})()');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#tourProgress").textContent.includes("1 / 4")', 'Chat starts tour');
    await waitFor('!document.querySelector("iframe").contentDocument.querySelector("#tourNext").disabled', 'Chat tour stop ready');
    await evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="next";doc.querySelector("#questionForm").requestSubmit()})()');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#tourProgress").textContent.includes("2 / 4")', 'Chat advances tour');
    await waitFor('!document.querySelector("iframe").contentDocument.querySelector("#tourNext").disabled', 'Second chat tour stop ready');
    await evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="stop tour";doc.querySelector("#questionForm").requestSubmit()})()');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#tourControls").hidden', 'Chat ends tour');
    await evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="how much are the plans";doc.querySelector("#questionForm").requestSubmit()})()');
    await waitFor('document.body.dataset.lastNovaStop === "pricing"', 'Pricing synonym navigation');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#messages").textContent.includes("sample plans")', 'Pricing answer');
    await evaluate('window.NovaEmbedConfig.onQuestion=()=>new Promise((resolve)=>setTimeout(()=>resolve({text:"late answer that should be ignored",target:"home"}),300))');
    await evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="quantum pancakes";doc.querySelector("#questionForm").requestSubmit()})()');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#send").textContent === "×"', 'Pending question can be canceled');
    await evaluate('document.querySelector("iframe").contentDocument.querySelector("#send").click()');
    await sleep(450);
    assert.equal(await evaluate('document.querySelector("iframe").contentDocument.querySelector("#messages").textContent.includes("late answer that should be ignored")'), false);
    assert.equal(await evaluate('document.body.dataset.lastNovaStop'), 'pricing');
    await evaluate('window.NovaEmbedConfig.onQuestion=async()=>({text:"I found the contact section for you.",target:"contact"})');
    await evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="quantum pancakes";doc.querySelector("#questionForm").requestSubmit()})()');
    await waitFor('document.body.dataset.lastNovaStop === "contact"', 'Custom callback target navigation');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#messages").textContent.includes("I found the contact section")', 'Custom callback reply');
    await evaluate('delete window.NovaEmbedConfig.onQuestion');
    if (process.env.CAPTURE_EMBED === '1') {
      if (process.env.CAPTURE_MOVES === '1') await evaluate('document.querySelector("iframe").contentDocument.querySelector("#reactionToggle").click()');
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
    assert.equal(await evaluate('window.NovaEmbed.navigate("missing-section")'), false);
    await evaluate('document.querySelector("iframe").contentDocument.querySelector("#collapse").click()');
    await waitFor('document.querySelector("iframe").style.width === "68px"', 'Widget minimized before host API');
    assert.equal(await evaluate('window.NovaEmbed.navigate("features")'), true);
    await waitFor('document.querySelector("iframe").style.width !== "68px" && !document.querySelector("iframe").contentDocument.body.classList.contains("compact")', 'Host API reopens widget');
    await waitFor('document.body.dataset.lastNovaStop === "features"', 'Host API destination');
    assert.equal(await evaluate('window.NovaEmbed.ask("show contact")'), true);
    await waitFor('document.body.dataset.lastNovaStop === "contact"', 'Host API question');
    await evaluate('document.querySelector("#hostPricingButton").click()');
    await waitFor('document.body.dataset.lastNovaStop === "pricing"', 'Host page button integration');
    await evaluate('const rootTest=document.createElement("iframe");rootTest.id="rootTest";rootTest.src="/";document.body.append(rootTest)');
    await waitFor('document.querySelector("#rootTest")?.contentDocument?.querySelector("#avatarActor")?.dataset.model === "Drok"', 'Starter page model');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#rootTest").contentDocument.querySelector("#avatarCanvas")).display'), 'none');
    await evaluate('(()=>{const doc=document.querySelector("#rootTest").contentDocument;doc.querySelector("#speechText").value="enter the website";doc.querySelector("#speechForm").requestSubmit()})()');
    await waitFor('!document.querySelector("#rootTest").contentDocument.body.classList.contains("intro-active")', 'Starter site unlock');
    await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("[data-walkthrough-target=features]").click()');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#chatHistory").textContent.includes("vowel sounds together")', 'Independent feature action');
    await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("[data-walkthrough-target=pricing]").click()');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#chatHistory").textContent.includes("no live prices")', 'Independent pricing action');
    await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("[data-walkthrough-target=contact]").click()');
    await waitFor('document.querySelector("#rootTest").contentDocument.activeElement?.name === "message"', 'Independent contact action');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#modelNotice").textContent.includes("Online AI ready")', 'Online provider ready for cancel test');
    await evaluate('(()=>{const win=document.querySelector("#rootTest").contentWindow;const original=win.fetch.bind(win);win.fetch=(resource,options)=>String(resource).includes("/api/online/chat")?new Promise((_,reject)=>options.signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true})):original(resource,options);const doc=win.document;doc.querySelector("#speechText").value="Tell me about elephants";doc.querySelector("#speechForm").requestSubmit()})()');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#askButton").textContent === "Stop"', 'Starter AI request can be stopped');
    await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("#askButton").click()');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#chatHistory").textContent.includes("Stopped. What would you like")', 'Starter AI request stopped');
    await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("[data-avatar-gesture=nod]").click()');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#avatarActor").dataset.animation === "nod"', 'Starter page nod');
    if (process.env.CAPTURE_STARTER === '1') {
      await evaluate('document.querySelector("#rootTest").style.cssText="position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647"');
      await sleep(300);
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const output = path.join(os.tmpdir(), 'nova-starter-preview.png');
      fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
      console.log(`Starter screenshot: ${output}`);
    }
    console.log('Browser test passed: both pages load the rigged model, reactions, cursor gaze, chat, tour, and widget controls.');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/embed/demo.html?personality=professional` });
    await sleep(500);
    await waitFor('document.querySelector("iframe")?.contentDocument?.querySelector(".panel-heading strong")?.textContent === "Mira"', 'Custom personality name');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#messages").textContent.includes("A small sample shop")', 'Site-specific greeting');
    await evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="what is this site";doc.querySelector("#questionForm").requestSubmit()})()');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#messages").textContent.includes("Sample Shop · Nova embed demo: A small sample shop")', 'Site metadata answer');
    await evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="show pricing";doc.querySelector("#questionForm").requestSubmit()})()');
    await waitFor('document.body.dataset.lastNovaStop === "pricing"', 'Personalized section navigation');
    await evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="tell me more about that";doc.querySelector("#questionForm").requestSubmit()})()');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#messages").lastElementChild?.textContent.includes("Pricing: Here are the sample plans")', 'Contextual follow-up');
    await evaluate('window.NovaEmbedConfig.onQuestion=(_question,_destinations,context)=>{document.body.dataset.personaContext=JSON.stringify(context);return "Custom answer."}');
    await evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="quantum pancakes";doc.querySelector("#questionForm").requestSubmit()})()');
    await waitFor('Boolean(document.body.dataset.personaContext)', 'AI callback receives site and personality');
    assert.equal(await evaluate('JSON.parse(document.body.dataset.personaContext).personality.name'), 'Mira');
    assert.equal(await evaluate('JSON.parse(document.body.dataset.personaContext).personality.instructions'), 'Be calm and concise.');
    assert.equal(await evaluate('JSON.parse(document.body.dataset.personaContext).site.description.includes("small sample shop")'), true);
    assert.ok(await evaluate('JSON.parse(document.body.dataset.personaContext).history.length > 0'));
    await send('Page.navigate', { url: `http://127.0.0.1:${hostPort}/` });
    await sleep(500);
    await waitFor('window.NovaEmbed && document.querySelector("iframe")', 'Independent host installation');
    assert.equal(await evaluate('new URL(document.querySelector("iframe").src).port'), String(port));
    assert.equal(await evaluate('window.NovaEmbed.navigate("pricing")'), true);
    await waitFor('document.body.dataset.lastNovaStop === "pricing"', 'Cross-origin host navigation');
    assert.equal(await evaluate('window.NovaEmbed.navigate("shipping-returns")'), true);
    await waitFor('document.body.dataset.lastNovaStop === "shipping-returns"', 'Automatic section discovery without an ID');
    console.log('Cross-origin install passed: independent host and Nova iframe exchanged guide actions.');
  } finally {
    socket?.close();
    chrome?.kill();
    server.kill();
    await new Promise((resolve) => independentHost.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
