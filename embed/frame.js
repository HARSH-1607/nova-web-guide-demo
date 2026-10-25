(() => {
  'use strict';
  const channel = new URLSearchParams(location.search).get('channel');
  if (!channel) return;
  const actor = document.getElementById('avatarActor');
  const form = document.getElementById('questionForm');
  const input = document.getElementById('question');
  const sendButton = document.getElementById('send');
  const messages = document.getElementById('messages');
  const prompts = document.getElementById('prompts');
  const status = document.getElementById('status');
  const soundToggle = document.getElementById('soundToggle');
  const collapse = document.getElementById('collapse');
  const restore = document.getElementById('restore');
  const startTour = document.getElementById('startTour');
  const tourStartRow = document.querySelector('.tour-start-row');
  const tourControls = document.getElementById('tourControls');
  const tourPrevious = document.getElementById('tourPrevious');
  const tourNext = document.getElementById('tourNext');
  const tourExit = document.getElementById('tourExit');
  const tourProgress = document.getElementById('tourProgress');
  const reactionToggle = document.getElementById('reactionToggle');
  const reactionChoices = document.getElementById('reactionChoices');
  let voiceEnabled = true;
  let speakingUntil = 0;
  let speechVersion = 0;
  let spokenText = '';
  let speechStartedAt = 0;
  let speechBoundaryIndex = -1;
  let speechBoundaryAt = 0;
  let gesture = null;
  let nextBlink = performance.now() + 3000;
  let blinkUntil = 0;
  let pointer = null;
  let pending = false;
  let destinations = [];
  let tourIndex = -1;
  let nextIdleGesture = performance.now() + 11000;
  let actorClicks = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reactions = {
    wave: ['Hello there! Give me a question or take the tour.', 2500],
    nod: ['Yes, I am listening.', 1900],
    shake: ['Not quite. Let us try another way.', 1900],
    think: ['Hmm. Ask me about a section and I will find it.', 2300],
    fistBump: ['Fist bump! We make a good team.', 1700],
    jump: ['Here we go!', 2000],
    dance: ['A little dance for you!', 4200],
    joy: ['That is worth celebrating!', 2400]
  };

  function post(type, extra = {}) {
    parent.postMessage({ novaChannel: channel, type, ...extra }, '*');
  }

  function bubble(who, message) {
    const element = document.createElement('div');
    element.className = `bubble ${who}`;
    element.textContent = message;
    messages.append(element);
    while (messages.children.length > 12) messages.firstElementChild.remove();
    messages.scrollTop = messages.scrollHeight;
  }

  function startGesture(type, duration = 2300) {
    gesture = { type, started: performance.now(), duration };
    nextIdleGesture = performance.now() + duration + 11000 + Math.random() * 5000;
  }

  function react(type) {
    const [line, duration] = reactions[type] || reactions.wave;
    startGesture(type, duration);
    bubble('nova', line);
    status.textContent = 'Speaking…';
    speak(line);
    reactionChoices.hidden = true;
    reactionToggle.setAttribute('aria-expanded', 'false');
  }

  function speak(message) {
    const version = ++speechVersion;
    spokenText = String(message || '');
    speechStartedAt = performance.now();
    speechBoundaryIndex = -1;
    if (!voiceEnabled || !('speechSynthesis' in window)) {
      speakingUntil = speechStartedAt + Math.min(10000, Math.max(1600, message.length * 52));
      return;
    }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    const voices = speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => /\b(aria|jenny|zira|ava|samantha|victoria|sonia|female)\b/i.test(voice.name) && /^en/i.test(voice.lang))
      || voices.find((voice) => /^en/i.test(voice.lang)) || null;
    speakingUntil = speechStartedAt + Math.min(15000, Math.max(1800, message.length * 65));
    utterance.onstart = () => {
      if (version !== speechVersion) return;
      speechStartedAt = performance.now();
      speakingUntil = speechStartedAt + Math.min(15000, Math.max(1800, message.length * 65));
    };
    utterance.onboundary = (event) => {
      if (version !== speechVersion || !Number.isFinite(event.charIndex)) return;
      speechBoundaryIndex = event.charIndex;
      speechBoundaryAt = performance.now();
    };
    utterance.onend = () => { if (version === speechVersion) { speakingUntil = 0; status.textContent = 'Ready to guide'; } };
    utterance.onerror = () => { if (version === speechVersion) { speakingUntil = 0; status.textContent = 'Ready to guide'; } };
    speechSynthesis.speak(utterance);
  }

  function speechMouthFrame(now) {
    if (!spokenText) return 0;
    const duration = Math.max(1, speakingUntil - speechStartedAt);
    const estimated = Math.floor((now - speechStartedAt) / duration * spokenText.length);
    const index = Math.min(spokenText.length - 1, Math.max(0,
      speechBoundaryIndex >= 0 ? speechBoundaryIndex + Math.floor((now - speechBoundaryAt) / 95) : estimated));
    const letter = spokenText[index]?.toLowerCase();
    const cue = letter === 'a' ? 1 : letter === 'e' ? 2
      : letter === 'i' || letter === 'y' ? 3 : letter === 'o' ? 4
        : letter === 'u' ? 5 : /[mbp.!?\s]/.test(letter || ' ') ? 6 : 2;
    return cue * 7 + Math.floor(now / 40) % 7;
  }

  function ask(question) {
    if (!question || pending) return;
    pending = true;
    sendButton.disabled = true;
    input.value = '';
    bubble('visitor', question);
    startGesture('think', 15000);
    status.textContent = 'Thinking…';
    post('question', { question });
  }

  function updateTourControls() {
    const active = tourIndex >= 0;
    tourStartRow.hidden = active;
    tourControls.hidden = !active;
    if (!active) return;
    tourProgress.textContent = `${tourIndex + 1} / ${destinations.length} · ${destinations[tourIndex].label}`;
    tourPrevious.disabled = pending || tourIndex === 0;
    tourNext.disabled = pending;
    tourNext.textContent = tourIndex === destinations.length - 1 ? 'Finish ✓' : 'Next →';
  }

  function endTour() {
    tourIndex = -1;
    updateTourControls();
    post('clearHighlight');
  }

  function visitTour(index) {
    if (pending || index < 0 || index >= destinations.length) return;
    tourIndex = index;
    const item = destinations[index];
    pending = true;
    sendButton.disabled = true;
    bubble('visitor', `Show me ${item.label}`);
    status.textContent = 'Finding section…';
    updateTourControls();
    post('navigate', { key: item.key });
  }

  startTour.addEventListener('click', () => {
    if (!destinations.length) { bubble('nova', 'There are no guide stops on this page yet.'); return; }
    visitTour(0);
  });
  tourPrevious.addEventListener('click', () => visitTour(tourIndex - 1));
  tourNext.addEventListener('click', () => {
    if (tourIndex === destinations.length - 1) {
      endTour();
      bubble('nova', 'That is the tour! Ask me about any section whenever you like.');
    } else visitTour(tourIndex + 1);
  });
  tourExit.addEventListener('click', endTour);
  reactionToggle.addEventListener('click', () => {
    reactionChoices.hidden = !reactionChoices.hidden;
    reactionToggle.setAttribute('aria-expanded', String(!reactionChoices.hidden));
  });
  reactionChoices.querySelectorAll('[data-gesture]').forEach((button) => {
    button.addEventListener('click', () => react(button.dataset.gesture));
  });

  form.addEventListener('submit', (event) => { event.preventDefault(); ask(input.value.trim()); });
  soundToggle.addEventListener('click', () => {
    voiceEnabled = !voiceEnabled;
    soundToggle.textContent = voiceEnabled ? '♫' : '♪̸';
    soundToggle.setAttribute('aria-label', voiceEnabled ? 'Turn voice off' : 'Turn voice on');
    if (!voiceEnabled) { speechVersion++; speakingUntil = 0; window.speechSynthesis?.cancel(); }
  });
  collapse.addEventListener('click', () => {
    document.body.classList.add('compact');
    restore.hidden = false;
    post('size', { compact: true });
  });
  restore.addEventListener('click', () => {
    document.body.classList.remove('compact');
    restore.hidden = true;
    post('size', { compact: false });
  });
  actor.addEventListener('click', () => { react(['wave', 'nod', 'joy', 'think'][actorClicks++ % 4]); });
  actor.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); actor.click(); } });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') collapse.click(); });
  window.addEventListener('pointermove', (event) => {
    pointer = { x: (event.clientX - innerWidth * 0.5) / innerWidth, y: (event.clientY - innerHeight * 0.35) / innerHeight };
    actor.dataset.gazeSource = 'widget';
  }, { passive: true });

  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.novaChannel !== channel) return;
    if (event.data.type === 'init') {
      const site = typeof event.data.siteTitle === 'string' ? event.data.siteTitle : 'this site';
      if (!messages.children.length) bubble('nova', `Hi! I'm Nova. I can help you explore ${site}.`);
      prompts.replaceChildren();
      destinations = (Array.isArray(event.data.targets) ? event.data.targets : [])
        .filter((item) => typeof item?.key === 'string' && typeof item?.label === 'string').slice(0, 12);
      if (tourIndex >= destinations.length) tourIndex = -1;
      updateTourControls();
      for (const item of destinations.slice(0, 4)) {
        if (typeof item?.key !== 'string') continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `Show ${item.key}`;
        button.addEventListener('click', () => ask(`Show me ${item.key}`));
        prompts.append(button);
      }
    } else if (event.data.type === 'reply' || event.data.type === 'navigated') {
      pending = false;
      sendButton.disabled = false;
      updateTourControls();
      const reply = typeof event.data.text === 'string' ? event.data.text.slice(0, 1000) : 'I could not answer that.';
      bubble('nova', reply);
      status.textContent = 'Speaking…';
      startGesture(['wave', 'dance', 'joy', 'point', 'nod', 'shake', 'think', 'fistBump', 'jump'].includes(event.data.gesture) ? event.data.gesture : 'point', 2500);
      speak(reply);
    } else if (event.data.type === 'pointer') {
      pointer = Number.isFinite(event.data.x) && Number.isFinite(event.data.y)
        ? { x: Math.max(-1, Math.min(1, event.data.x)), y: Math.max(-1, Math.min(1, event.data.y)) } : null;
      actor.dataset.gazeSource = pointer ? 'host' : 'idle';
    }
  });

  function animate(now) {
    if (now > nextBlink) { blinkUntil = now + 150; nextBlink = now + 2800 + Math.random() * 2800; }
    if (gesture && now - gesture.started > gesture.duration) gesture = null;
    const talking = now < speakingUntil;
    if (!reducedMotion && !gesture && !talking && !pending && now > nextIdleGesture) {
      startGesture(Math.random() < 0.55 ? 'nod' : 'think', 1500);
    }
    if (talking) status.textContent = 'Speaking…';
    else if (!pending) status.textContent = 'Ready to guide';
    window.Nova3D?.sync({
      walking: false,
      walkStarted: 0,
      direction: 0,
      gesture,
      speechFrame: talking ? speechMouthFrame(now) : null,
      blink: now < blinkUntil,
      gaze: pointer ? { x: Math.max(-1, Math.min(1, pointer.x)), y: Math.max(-1, Math.min(1, pointer.y)) } : null
    }, now);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
  post('ready');
})();
