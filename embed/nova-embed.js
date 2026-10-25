/* Drop-in Nova widget. Set window.NovaEmbedConfig before loading this script. */
(() => {
  'use strict';
  if (window.NovaEmbed) return;

  const script = document.currentScript;
  const base = new URL('./', script.src);
  const config = window.NovaEmbedConfig || {};
  const channel = globalThis.crypto?.randomUUID?.() || `nova-${Date.now()}-${Math.random()}`;
  const frame = document.createElement('iframe');
  frame.title = config.title || 'Nova website guide';
  frame.setAttribute('aria-label', frame.title);
  frame.setAttribute('allow', 'autoplay');
  frame.src = new URL(`frame.html?channel=${encodeURIComponent(channel)}`, base).href;
  frame.style.cssText = 'position:fixed;right:8px;bottom:8px;border:0;background:transparent;z-index:2147483646;color-scheme:dark;';
  let compact = false;
  let frameReady = false;
  let queuedAsk = null;
  function sizeFrame() {
    frame.style.width = compact ? '68px' : innerWidth < 600 ? 'min(340px,calc(100vw - 16px))' : 'min(390px,100vw)';
    frame.style.height = compact ? '68px' : innerWidth < 600 ? 'min(470px,calc(100vh - 16px))' : 'min(560px,100vh)';
  }
  sizeFrame();
  let pointerFrame = 0;
  let latestPointer = null;
  function onPointerMove(event) {
    latestPointer = { x: event.clientX, y: event.clientY };
    if (pointerFrame || frame.hidden || compact) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      if (!latestPointer || frame.hidden || compact) return;
      const bounds = frame.getBoundingClientRect();
      send('pointer', {
        x: (latestPointer.x - bounds.left - bounds.width / 2) / Math.max(180, bounds.width / 2),
        y: (latestPointer.y - bounds.top - bounds.height * 0.37) / Math.max(180, bounds.height / 2)
      });
    });
  }
  function onBlur() { send('pointer'); }

  let highlighted = null;
  let highlightTimer = 0;
  let currentRequestId = 0;
  function clearHighlight() {
    if (!highlighted) return;
    highlighted.element.style.outline = highlighted.outline;
    highlighted.element.style.outlineOffset = highlighted.outlineOffset;
    highlighted.element.style.boxShadow = highlighted.boxShadow;
    highlighted = null;
  }

  function targets() {
    const result = new Map();
    for (const element of document.querySelectorAll('[data-nova-guide], main section[id], section[id], header[id], footer[id]')) {
      const key = element.dataset.novaGuide || element.id;
      if (!key || result.has(key)) continue;
      const heading = element.querySelector('h1,h2,h3');
      result.set(key, {
        key, element,
        label: (element.dataset.novaLabel || heading?.textContent || key).trim().slice(0, 80),
        description: (element.dataset.novaDescription || `This is the ${key.replace(/[-_]/g, ' ')} section.`).trim().slice(0, 300),
        aliases: (element.dataset.novaAliases || '').split(',').map((alias) => alias.trim()).filter(Boolean)
      });
    }
    for (const [key, entry] of Object.entries(config.targets || {})) {
      const options = typeof entry === 'string' ? { selector: entry } : entry;
      if (!options?.selector) continue;
      let element;
      try { element = document.querySelector(options.selector); } catch { continue; }
      if (!element) continue;
      result.set(key, {
        key, element,
        label: String(options.label || key).slice(0, 80),
        description: String(options.description || `This is the ${key} section.`).slice(0, 300),
        aliases: Array.isArray(options.aliases) ? options.aliases.map(String) : []
      });
    }
    return [...result.values()].slice(0, 40);
  }

  function send(type, extra = {}) {
    frame.contentWindow?.postMessage({ novaChannel: channel, type, ...extra }, base.origin);
  }

  function normalized(value) {
    return String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  function matchTarget(question, items) {
    const query = ` ${normalized(question)} `;
    const commonAliases = {
      home: ['start', 'top', 'homepage'],
      features: ['feature', 'capabilities', 'what it does'],
      pricing: ['price', 'prices', 'plan', 'plans', 'cost', 'how much'],
      contact: ['email', 'message', 'get in touch', 'reach you']
    };
    let best = null;
    let bestLength = 0;
    for (const item of items) {
      for (const alias of [item.key, item.label, ...item.aliases, ...(commonAliases[item.key] || [])]) {
        const phrase = normalized(alias);
        if (phrase.length >= 3 && query.includes(` ${phrase} `) && phrase.length > bestLength) {
          best = item;
          bestLength = phrase.length;
        }
      }
    }
    return best;
  }

  function navigateTo(item) {
    item.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    clearHighlight();
    highlighted = {
      element: item.element,
      outline: item.element.style.outline,
      outlineOffset: item.element.style.outlineOffset,
      boxShadow: item.element.style.boxShadow
    };
    item.element.style.outline = '3px solid #8ef6d9';
    item.element.style.outlineOffset = '6px';
    item.element.style.boxShadow = '0 0 34px rgba(86,221,190,.36)';
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(clearHighlight, 6000);
    if (typeof config.onNavigate === 'function') {
      try { Promise.resolve(config.onNavigate(item.key, item.element)).catch((error) => console.warn('Nova onNavigate callback failed:', error)); }
      catch (error) { console.warn('Nova onNavigate callback failed:', error); }
    }
    return { text: item.description, gesture: 'point', target: item.key };
  }

  async function answer(question) {
    const items = targets();
    const match = matchTarget(question, items);
    if (match) return navigateTo(match);
    if (/\b(wave|hello|hi)\b/i.test(question)) return { text: 'Hi! I can guide you around this page.', gesture: 'wave' };
    if (/\b(dance|celebrate)\b/i.test(question)) return { text: 'A little celebration for us!', gesture: 'dance' };
    if (/\b(nod|agree)\b/i.test(question)) return { text: 'Yes, I am with you!', gesture: 'nod' };
    if (/\b(shake your head|say no|disagree)\b/i.test(question)) return { text: 'Not quite. Let us look at it another way.', gesture: 'shake' };
    if (/\b(fist.?bump|high.?five)\b/i.test(question)) return { text: 'Fist bump! We make a good team.', gesture: 'fistBump' };
    if (/\b(jump|hop)\b/i.test(question)) return { text: 'Here we go!', gesture: 'jump' };
    if (/\b(think pose|look thoughtful|thinking animation)\b/i.test(question)) return { text: 'Let me think about that.', gesture: 'think' };
    if (typeof config.onQuestion === 'function') {
      let timer;
      const custom = await Promise.race([
        Promise.resolve().then(() => config.onQuestion(question,
          items.map(({ key, label, description }) => ({ key, label, description })))),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Question callback timed out')), 15000); })
      ]).finally(() => clearTimeout(timer));
      if (typeof custom === 'string') return { text: custom.slice(0, 1000), gesture: 'point' };
      if (custom && typeof custom.text === 'string') {
        const destination = items.find((item) => item.key === custom.target);
        return { text: custom.text.slice(0, 1000), gesture: custom.gesture || 'point', target: destination?.key, navigateTarget: destination?.key };
      }
    }
    const names = items.slice(0, 3).map((item) => item.key).join(', ');
    return { text: names ? `I can show you ${names}. Ask me where to go!` : 'Add data-nova-guide to a section so I can guide visitors there.', gesture: 'point' };
  }

  async function onMessage(event) {
    if (event.source !== frame.contentWindow || event.origin !== base.origin || event.data?.novaChannel !== channel) return;
    if (event.data.type === 'ready') {
      frameReady = true;
      send('init', { siteTitle: document.title.slice(0, 100), targets: targets().map(({ key, label }) => ({ key, label })) });
      if (queuedAsk) { send('hostAsk', { question: queuedAsk }); queuedAsk = null; }
    } else if (event.data.type === 'question') {
      const question = typeof event.data.question === 'string' ? event.data.question.trim().slice(0, 500) : '';
      if (!question) return;
      const requestId = Number.isSafeInteger(event.data.requestId) ? event.data.requestId : 0;
      currentRequestId = requestId;
      try {
        const result = await answer(question);
        if (currentRequestId !== requestId) return;
        if (result.navigateTarget) {
          const destination = targets().find((item) => item.key === result.navigateTarget);
          if (destination) navigateTo(destination);
        }
        send('reply', { text: result.text, gesture: result.gesture, target: result.target, requestId });
      } catch (error) {
        if (currentRequestId !== requestId) return;
        console.warn('Nova embed response failed:', error);
        send('reply', { text: 'I could not answer that right now. Try a section name, or use the tour controls.', requestId });
      }
    } else if (event.data.type === 'navigate') {
      const key = typeof event.data.key === 'string' ? event.data.key : '';
      const requestId = Number.isSafeInteger(event.data.requestId) ? event.data.requestId : 0;
      currentRequestId = requestId;
      const item = targets().find((target) => target.key === key);
      send('navigated', { ...(item ? navigateTo(item) : { text: 'That destination is no longer on this page.', gesture: 'wave' }), requestId });
    } else if (event.data.type === 'cancel') {
      if (event.data.requestId === currentRequestId) currentRequestId = 0;
    } else if (event.data.type === 'clearHighlight') {
      clearTimeout(highlightTimer);
      clearHighlight();
    } else if (event.data.type === 'size') {
      compact = event.data.compact === true;
      sizeFrame();
    }
  }

  window.addEventListener('message', onMessage);
  window.addEventListener('resize', sizeFrame);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('blur', onBlur);
  (document.body || document.documentElement).append(frame);
  function askFromHost(value) {
    const question = typeof value === 'string' ? value.trim().slice(0, 500) : '';
    if (!question) return false;
    frame.hidden = false;
    compact = false;
    sizeFrame();
    if (frameReady) send('hostAsk', { question });
    else queuedAsk = question;
    return true;
  }
  window.NovaEmbed = {
    show() { frame.hidden = false; },
    hide() { frame.hidden = true; },
    ask(question) { return askFromHost(question); },
    navigate(key) {
      const item = targets().find((target) => target.key === key);
      return item ? askFromHost(`Show me ${item.key}`) : false;
    },
    refreshTargets() { send('init', { siteTitle: document.title.slice(0, 100), targets: targets().map(({ key, label }) => ({ key, label })) }); },
    destroy() { clearTimeout(highlightTimer); clearHighlight(); cancelAnimationFrame(pointerFrame); window.removeEventListener('message', onMessage); window.removeEventListener('resize', sizeFrame); window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('blur', onBlur); frame.remove(); delete window.NovaEmbed; }
  };
})();
