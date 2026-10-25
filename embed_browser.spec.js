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
    env: { ...process.env, PORT: String(port), PUBLIC_DEMO: '', RENDER: '',
      AI_CHAT_PROVIDER: 'openai', PAID_VOICE_ENABLED: 'false', OPENAI_API_KEY: 'browser-test-key' }, stdio: 'ignore'
  });
  const independentHost = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>Independent host</title><main><section id="pricing" data-nova-guide="pricing" data-nova-description="Plans on an independent origin"><h1>Pricing</h1></section><section><h2>Shipping &amp; Returns</h2><p>Delivery and returns information.</p></section></main><script>window.DorkEmbedConfig={onNavigate(key){document.body.dataset.lastNovaStop=key}}</script><script src="http://127.0.0.1:${port}/embed/nova-embed.js"></script>`);
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
    async function waitFor(expression, label, attempts = 150) {
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (await evaluate(expression)) return;
        await sleep(100);
      }
      throw new Error(`${label} timed out`);
    }
    await waitFor('document.querySelector("iframe")?.contentDocument?.querySelector("#messages")?.textContent.includes("Dork")', 'Widget greeting');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#avatarActor").dataset.model === "Drok"', 'Blender Drok model');
    assert.equal(await evaluate('document.querySelector("iframe").contentDocument.querySelector("#avatarActor").dataset.renderer'), 'three');
    const spikeFlow = await evaluate(`(async()=>{
      const win=document.querySelector('iframe').contentWindow;
      const [{loadDrokAvatar},THREE]=await Promise.all([
        win.eval('import("../drok-avatar.js")'),win.eval('import("../vendor/three.module.js")')
      ]);
      const scene=new THREE.Scene();
      const avatar=await loadDrokAvatar(scene);
      let spike;
      scene.traverse((object)=>{if(/crown.?thorn/i.test(object.name))spike=object});
      if(!spike)return {names:scene.children.map((child)=>child.name)};
      const position=spike.geometry.getAttribute('position');
      let root=0,tip=0,near=Infinity,far=-Infinity;
      for(let i=0;i<position.count;i++){
        const radius=Math.hypot(position.getX(i),position.getY(i)-1.75,position.getZ(i));
        if(radius<near){near=radius;root=i}
        if(radius>far){far=radius;tip=i}
      }
      const startRoot=[position.getX(root),position.getY(root),position.getZ(root)];
      const startTip=[position.getX(tip),position.getY(tip),position.getZ(tip)];
      for(let time=1000;time<=3000;time+=16)avatar.sync({},time,.016);
      const endRoot=[position.getX(root),position.getY(root),position.getZ(root)];
      const endTip=[position.getX(tip),position.getY(tip),position.getZ(tip)];
      avatar.sync({speechFrame:7},3016,.016);
      const mouth=scene.getObjectByName('Drok_talk_mouth_control');
      const mouthWidth=mouth?.scale.x||0;
      const mouthHeight=mouth?.scale.y||0;
      const eye=scene.getObjectByName('Drok_L_eye_blink');
      const openEye=eye.scale.y;
      for(let time=3032;time<=3130;time+=16)avatar.sync({blink:true},time,.016);
      const closedEye=eye.scale.y;
      for(let time=3146;time<=3600;time+=16)avatar.sync({},time,.016);
      const recoveredEye=eye.scale.y;
      return {spikeName:spike.name,rootDrift:Math.hypot(...endRoot.map((value,i)=>value-startRoot[i])),
        tipTravel:Math.hypot(...endTip.map((value,i)=>value-startTip[i])),mouthWidth,
        mouthHeight,openEye,closedEye,recoveredEye};
    })()`);
    assert.ok(spikeFlow.tipTravel > 0.005, `Spike tip did not flow: ${JSON.stringify(spikeFlow)}`);
    assert.ok(spikeFlow.rootDrift < 0.001, `Spike root should stay anchored: ${JSON.stringify(spikeFlow)}`);
    assert.ok(spikeFlow.mouthWidth > 0.1, `Speaking did not drive the mouth: ${JSON.stringify(spikeFlow)}`);
    assert.ok(spikeFlow.mouthHeight > 0.1, `Speech did not open the mouth vertically: ${JSON.stringify(spikeFlow)}`);
    assert.ok(spikeFlow.closedEye < spikeFlow.openEye * 0.7, `Blink did not close the eye: ${JSON.stringify(spikeFlow)}`);
    assert.ok(spikeFlow.recoveredEye > spikeFlow.closedEye * 1.5, `Eye did not reopen: ${JSON.stringify(spikeFlow)}`);
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
    await evaluate('window.DorkEmbedConfig.onQuestion=()=>new Promise((resolve)=>setTimeout(()=>resolve({text:"late answer that should be ignored",target:"home"}),300))');
    await evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="quantum pancakes";doc.querySelector("#questionForm").requestSubmit()})()');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#send").textContent === "×"', 'Pending question can be canceled');
    await evaluate('document.querySelector("iframe").contentDocument.querySelector("#send").click()');
    await sleep(450);
    assert.equal(await evaluate('document.querySelector("iframe").contentDocument.querySelector("#messages").textContent.includes("late answer that should be ignored")'), false);
    assert.equal(await evaluate('document.body.dataset.lastNovaStop'), 'pricing');
    await evaluate('window.DorkEmbedConfig.onQuestion=async()=>({text:"I found the contact section for you.",target:"contact"})');
    await evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="quantum pancakes";doc.querySelector("#questionForm").requestSubmit()})()');
    await waitFor('document.body.dataset.lastNovaStop === "contact"', 'Custom callback target navigation');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#messages").textContent.includes("I found the contact section")', 'Custom callback reply');
    assert.ok(await evaluate('(()=>{const d=document.querySelector("iframe").contentDocument;const p=d.querySelector(".panel").getBoundingClientRect();const f=d.querySelector("#questionForm").getBoundingClientRect();return f.bottom<=p.bottom&&f.top>=p.top})()'), 'Widget composer remains visible');
    await evaluate('delete window.DorkEmbedConfig.onQuestion');
    if (process.env.CAPTURE_EMBED === '1') {
      if (process.env.CAPTURE_MOVES === '1') await evaluate('document.querySelector("iframe").contentDocument.querySelector("#reactionToggle").click()');
      console.log('Widget layout:', await evaluate('(()=>{const p=document.querySelector("iframe").contentDocument.querySelector(".panel");return {height:p.clientHeight,scrollHeight:p.scrollHeight,maxHeight:getComputedStyle(p).maxHeight}})()'));
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const output = path.join(os.tmpdir(), 'nova-embed-preview.png');
      fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
      console.log(`Embed screenshot: ${output}`);
    }
    await evaluate('window.DorkEmbed.hide()');
    assert.ok(await evaluate('document.querySelector("iframe").hidden'));
    await evaluate('window.DorkEmbed.show()');
    assert.ok(await evaluate('!document.querySelector("iframe").hidden'));
    await evaluate('document.querySelector("iframe").contentDocument.querySelector("#collapse").click()');
    await waitFor('document.querySelector("iframe").style.width === "68px"', 'Widget minimize');
    await evaluate('document.querySelector("iframe").contentDocument.querySelector("#restore").click()');
    await waitFor('document.querySelector("iframe").style.width !== "68px"', 'Widget restore');
    assert.equal(await evaluate('window.DorkEmbed.navigate("missing-section")'), false);
    await evaluate('document.querySelector("iframe").contentDocument.querySelector("#collapse").click()');
    await waitFor('document.querySelector("iframe").style.width === "68px"', 'Widget minimized before host API');
    assert.equal(await evaluate('window.DorkEmbed.navigate("features")'), true);
    await waitFor('document.querySelector("iframe").style.width !== "68px" && !document.querySelector("iframe").contentDocument.body.classList.contains("compact")', 'Host API reopens widget');
    await waitFor('document.body.dataset.lastNovaStop === "features"', 'Host API destination');
    assert.equal(await evaluate('window.DorkEmbed.ask("show contact")'), true);
    await waitFor('document.body.dataset.lastNovaStop === "contact"', 'Host API question');
    await evaluate('document.querySelector("#hostPricingButton").click()');
    await waitFor('document.body.dataset.lastNovaStop === "pricing"', 'Host page button integration');
    await evaluate('const rootTest=document.createElement("iframe");rootTest.id="rootTest";rootTest.src="/";rootTest.style.cssText="position:fixed;inset:0;width:100vw;height:100dvh;border:0;z-index:2147483647";document.body.append(rootTest)');
    await waitFor('document.querySelector("#rootTest")?.contentDocument?.querySelector("#avatarActor")?.dataset.model === "Drok"', 'Starter page model');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#modelNotice").textContent.includes("Online AI ready")', 'Online AI default ready', 300);
    if (process.env.CAPTURE_STARTER_INTRO === '1') {
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const output = path.join(os.tmpdir(), 'dork-starter-intro-preview.png');
      fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
      console.log(`Starter intro screenshot: ${output}`);
    }
    assert.equal(await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("#aiProvider").value'), 'online');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#rootTest").contentDocument.querySelector("#avatarCanvas")).display'), 'none');
    assert.equal(await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("#chatHistory, #speechForm")'), null, 'Starter page has no chat interface');
    assert.equal(await evaluate('document.querySelector("#rootTest").contentDocument.querySelector(".control-panel")'), null, 'Starter has no control box');
    assert.ok(await evaluate('(()=>{const r=document.querySelector("#rootTest").contentDocument.querySelector("#listenButton").getBoundingClientRect();return r.width>=44&&r.right<=innerWidth&&r.bottom<=innerHeight})()'), 'Microphone button fits viewport');
    await evaluate('(()=>{const win=document.querySelector("#rootTest").contentWindow;win.__voiceMock={startCount:0,stopCount:0};const proto=(win.SpeechRecognition||win.webkitSpeechRecognition).prototype;proto.start=function(){win.__voiceMock.startCount++;win.__voiceMock.instance=this};proto.stop=function(){win.__voiceMock.stopCount++;this.onend?.()}})()');
    await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("#listenButton").click()');
    await waitFor('document.querySelector("#rootTest").contentWindow.__voiceMock.startCount === 1', 'Voice toggle starts recognition');
    assert.equal(await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("#listenButton").getAttribute("aria-pressed")'), 'true');
    await evaluate('(()=>{const win=document.querySelector("#rootTest").contentWindow;win.__voiceMock.instance.onresult({results:[[{transcript:"wave"}]]})})()');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#dorkCaption").textContent.includes("Here is a wave")', 'Spoken command triggers character gesture');
    await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("#listenButton").click()');
    assert.equal(await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("#listenButton").getAttribute("aria-pressed")'), 'false');
    await evaluate('document.querySelector("#rootTest").contentWindow.DorkGuide.ask("open the site")');
    await waitFor('!document.querySelector("#rootTest").contentDocument.body.classList.contains("intro-active")', 'Starter site unlock');
    await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("[data-walkthrough-target=features]").click()');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#dorkCaption").textContent.includes("vowel sounds together")', 'Independent feature action');
    await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("[data-walkthrough-target=pricing]").click()');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#dorkCaption").textContent.includes("no live prices")', 'Independent pricing action');
    await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("[data-walkthrough-target=contact]").click()');
    await waitFor('document.querySelector("#rootTest").contentDocument.activeElement?.name === "message"', 'Independent contact action');
    await evaluate('(()=>{const select=document.querySelector("#rootTest").contentDocument.querySelector("#aiProvider");select.value="online";select.dispatchEvent(new Event("change"))})()');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#modelNotice").textContent.includes("Online AI ready")', 'Online provider ready for cancel test');
    await evaluate('(()=>{const win=document.querySelector("#rootTest").contentWindow;const original=win.fetch.bind(win);win.fetch=(resource,options)=>String(resource).includes("/api/online/plan")?new Promise((_,reject)=>options.signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true})):original(resource,options);win.DorkGuide.ask("Tell me about elephants")})()');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#avatarStatus").textContent === "Thinking…"', 'Voice AI request can be stopped');
    await evaluate('document.querySelector("#rootTest").contentWindow.DorkGuide.ask("")');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#dorkCaption").textContent.includes("Stopped. What would you like")', 'Voice AI request stopped');
    await evaluate('(()=>{const win=document.querySelector("#rootTest").contentWindow;const target=win.document.querySelector("[data-guide-spot=workflow]");target.dispatchEvent(new win.PointerEvent("pointermove",{bubbles:true,clientX:40,clientY:40}));win.DorkGuide.ask("show me that")})()');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#dorkCaption").textContent.includes("interactive workflow demo")', 'Pointed target resolves from speech');
    await evaluate('document.querySelector("#rootTest").contentWindow.DorkGuide.ask("stop")');
    await evaluate('(()=>{const win=document.querySelector("#rootTest").contentWindow;const prior=win.fetch;win.__planCalls=0;win.__plannedResponse={action:"navigate",target:"spot:pricing",gesture:null,reply:"I found the plans."};win.fetch=(resource,options)=>{if(String(resource).includes("/api/online/plan")){win.__planCalls++;return Promise.resolve(new win.Response(JSON.stringify(win.__plannedResponse),{status:200,headers:{"Content-Type":"application/json"}}))}return prior(resource,options)};win.DorkGuide.ask("bring me to the money stuff")})()');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#dorkCaption").textContent.includes("example plans")', 'AI plans a natural-language destination');
    await evaluate('document.querySelector("#rootTest").contentWindow.DorkGuide.ask("bring me to the money stuff")');
    await sleep(150);
    assert.equal(await evaluate('document.querySelector("#rootTest").contentWindow.__planCalls'), 1, 'Dork remembers the visitor’s phrasing on this browser');
    await evaluate('document.querySelector("#rootTest").contentWindow.DorkGuide.ask("when I say home base, I mean workflow")');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#dorkCaption").textContent.includes("home base")', 'Visitor teaches a phrase');
    await evaluate('document.querySelector("#rootTest").contentWindow.DorkGuide.ask("home base")');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#dorkCaption").textContent.includes("interactive workflow demo")', 'Taught phrase moves to chosen destination');
    assert.equal(await evaluate('document.querySelector("#rootTest").contentWindow.__planCalls'), 1, 'Taught phrase works without another AI call');
    await evaluate('document.querySelector("#rootTest").contentWindow.DorkGuide.ask("take me to the growth plan")');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#dorkCaption").textContent.includes("Growth plan is a placeholder")', 'Dork can navigate to a specific card');
    await evaluate('(()=>{const win=document.querySelector("#rootTest").contentWindow;win.__plannedResponse={action:"activate",target:"control:filter:growth",gesture:null,reply:"I can filter those ideas."};win.DorkGuide.ask("filter the ideas down to growth")})()');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("[data-integration-filter=growth]").getAttribute("aria-pressed") === "true"', 'Natural-language action activates a real page control');
    assert.equal(await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("[data-guide-spot=help-center]").hidden'), true);
    await evaluate('document.querySelector("#rootTest").contentWindow.DorkGuide.ask("stop")');
    await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("#avatarHit").click()');
    await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("#avatarHit").click()');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#avatarActor").dataset.animation === "nod"', 'Character tap cycles reactions');
    await evaluate('document.querySelector("#rootTest").contentWindow.DorkGuide.ask("nod")');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#avatarActor").dataset.animation === "nod"', 'Starter page nod');
    await evaluate('document.querySelector("#rootTest").contentWindow.DorkGuide.ask("spin")');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#avatarActor").dataset.animation === "dance"', 'Procedural spin uses the dance rig');
    await evaluate('document.querySelector("#rootTest").contentWindow.DorkGuide.ask("bow")');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#avatarActor").dataset.animation === "nod"', 'Procedural bow uses the nod rig');
    await evaluate('(()=>{const win=document.querySelector("#rootTest").contentWindow;win.speechSynthesis.cancel();win.__spoken=[];win.speechSynthesis.speak=(utterance)=>{win.__spoken.push(utterance);utterance.onstart?.()};win.speechSynthesis.cancel=()=>{};win.DorkGuide.startTour()})()');
    await waitFor('document.querySelector("#rootTest").contentWindow.__spoken.some((utterance)=>utterance.text.includes("Let me show you speech motion"))', 'First tour instruction speaks');
    await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("[data-walkthrough-target=features]").click()');
    await sleep(1900);
    assert.equal(await evaluate('document.querySelector("#rootTest").contentWindow.__spoken.length'), 1, 'Early click must not interrupt the instruction');
    await evaluate('document.querySelector("#rootTest").contentWindow.__spoken[0].onend()');
    await waitFor('document.querySelector("#rootTest").contentWindow.__spoken.length === 2', 'Step acknowledgement begins after instruction');
    assert.ok(await evaluate('document.querySelector("#rootTest").contentWindow.__spoken[1].text.includes("approximate mouth motion")'));
    await sleep(1900);
    assert.equal(await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("#dorkCaption").textContent.includes("Here is the pricing section")'), false, 'Next stop must wait for the whole acknowledgement');
    await evaluate('document.querySelector("#rootTest").contentWindow.__spoken[1].onend()');
    await waitFor('document.querySelector("#rootTest").contentDocument.querySelector("#dorkCaption").textContent.includes("Here is the pricing section")', 'Tour advances after speech completion');
    await evaluate('document.querySelector("#rootTest").contentDocument.querySelector("#skipGuide").click()');
    if (process.env.CAPTURE_STARTER === '1') {
      await evaluate('document.querySelector("#rootTest").style.cssText="position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647"');
      await sleep(300);
      const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const output = path.join(os.tmpdir(), 'nova-starter-preview.png');
      fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
      console.log(`Starter screenshot: ${output}`);
    }
    console.log('Browser test passed: the starter uses character controls and the portable widget keeps its chat, tour, and reactions.');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/embed/demo.html?personality=professional` });
    await sleep(500);
    await waitFor('document.querySelector("iframe")?.contentDocument?.querySelector(".panel-heading strong")?.textContent === "Mira"', 'Custom personality name');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#messages").textContent.includes("A small sample shop")', 'Site-specific greeting');
    await evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="what is this site";doc.querySelector("#questionForm").requestSubmit()})()');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#messages").textContent.includes("Sample Shop · Dork embed demo: A small sample shop")', 'Site metadata answer');
    await evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="show pricing";doc.querySelector("#questionForm").requestSubmit()})()');
    await waitFor('document.body.dataset.lastNovaStop === "pricing"', 'Personalized section navigation');
    await evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="tell me more about that";doc.querySelector("#questionForm").requestSubmit()})()');
    await waitFor('document.querySelector("iframe").contentDocument.querySelector("#messages").lastElementChild?.textContent.includes("Pricing: Here are the sample plans")', 'Contextual follow-up');
    await evaluate('window.DorkEmbedConfig.onQuestion=(_question,_destinations,context)=>{document.body.dataset.personaContext=JSON.stringify(context);return "Custom answer."}');
    await evaluate('(()=>{const doc=document.querySelector("iframe").contentDocument;doc.querySelector("#question").value="quantum pancakes";doc.querySelector("#questionForm").requestSubmit()})()');
    await waitFor('Boolean(document.body.dataset.personaContext)', 'AI callback receives site and personality');
    assert.equal(await evaluate('JSON.parse(document.body.dataset.personaContext).personality.name'), 'Mira');
    assert.equal(await evaluate('JSON.parse(document.body.dataset.personaContext).personality.instructions'), 'Be calm and concise.');
    assert.equal(await evaluate('JSON.parse(document.body.dataset.personaContext).site.description.includes("small sample shop")'), true);
    assert.ok(await evaluate('JSON.parse(document.body.dataset.personaContext).history.length > 0'));
    await send('Page.navigate', { url: `http://127.0.0.1:${hostPort}/` });
    await sleep(500);
    await waitFor('window.DorkEmbed && document.querySelector("iframe")', 'Independent host installation');
    assert.equal(await evaluate('new URL(document.querySelector("iframe").src).port'), String(port));
    assert.equal(await evaluate('window.DorkEmbed.navigate("pricing")'), true);
    await waitFor('document.body.dataset.lastNovaStop === "pricing"', 'Cross-origin host navigation');
    assert.equal(await evaluate('window.DorkEmbed.navigate("shipping-returns")'), true);
    await waitFor('document.body.dataset.lastNovaStop === "shipping-returns"', 'Automatic section discovery without an ID');
    console.log('Cross-origin install passed: independent host and Dork iframe exchanged guide actions.');
  } finally {
    socket?.close();
    chrome?.kill();
    server.kill();
    await new Promise((resolve) => independentHost.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
