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
  let requestCounter = 0;
  let activeRequestId = 0;
  let destinations = [];
  let tourIndex = -1;
  let site = { title: 'this site', description: '', headline: '' };
  let personality = { name: 'Nova', tone: 'friendly' };
  let history = [];
  let nextIdleGesture = performance.now() + 11000;
  let actorClicks = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reactionDurations = {
    wave: 2500, nod: 1900, shake: 1900, think: 2300,
    fistBump: 1700, jump: 2000, dance: 4200, joy: 2400
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
    history.push({ role: who === 'visitor' ? 'user' : 'assistant', content: message });
    history = history.slice(-8);
  }

  function reactionLine(type) {
    const style = { friendly: 0, professional: 1, playful: 2 }[personality.tone] || 0;
    const lines = {
      wave: [`Hi! I'm ${personality.name}. Want to explore ${site.title}?`, `Hello. I'm ${personality.name}, ready to guide you through ${site.title}.`, `Hey, I'm ${personality.name}! Let's discover ${site.title}!`],
      nod: ['Yes, I am listening.', 'Understood. I am listening.', 'Yep, I am all ears!'],
      shake: ['Not quite. Let us try another way.', 'That does not appear to be the right path. Let us try another.', 'Oops, not that way. Let us try again!'],
      think: [`Let me think about ${site.title}. What would you like to find?`, `I can help locate information on ${site.title}. What do you need?`, `Hmm, let me explore ${site.title} with you!`],
      fistBump: ['Fist bump! We make a good team.', 'Well done. We made progress together.', 'Fist bump! Teamwork wins!'],
      jump: ['Here we go!', 'Moving to the next step.', 'Here we go—adventure time!'],
      dance: ['A little dance for you!', 'A brief celebration.', 'A happy dance, just for you!'],
      joy: ['That is worth celebrating!', 'Excellent progress.', 'We did it! Let us celebrate!']
    };
    return (lines[type] || lines.wave)[style];
  }

  function startGesture(type, duration = 2300) {
    gesture = { type, started: performance.now(), duration };
    nextIdleGesture = performance.now() + duration + 11000 + Math.random() * 5000;
  }

  function react(type) {
    const duration = reactionDurations[type] || reactionDurations.wave;
    const line = reactionLine(type);
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
    utterance.rate = personality.tone === 'professional' ? 0.9 : personality.tone === 'playful' ? 1.05 : 0.95;
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

  function clearPending() {
    const stoppedRequestId = activeRequestId;
    pending = false;
    activeRequestId = 0;
    sendButton.disabled = false;
    sendButton.textContent = '↗';
    sendButton.setAttribute('aria-label', 'Send message');
    updateTourControls();
    if (stoppedRequestId) post('cancel', { requestId: stoppedRequestId });
  }

  function beginPending() {
    pending = true;
    activeRequestId = ++requestCounter;
    sendButton.textContent = '×';
    sendButton.setAttribute('aria-label', 'Cancel or replace question');
    updateTourControls();
    return activeRequestId;
  }

  function ask(question) {
    if (!question) {
      if (pending) { clearPending(); status.textContent = 'Ready to guide'; bubble('nova', 'Stopped. Ask me something else whenever you like.'); }
      return;
    }
    if (pending) clearPending();
    input.value = '';
    if (/\b(stop|exit|end|cancel)\b.*\b(tour|walk.?through)\b/i.test(question) && tourIndex < 0) {
      bubble('visitor', question);
      bubble('nova', 'No tour is running. Ask me to show you around when you are ready.');
      return;
    }
    if (tourIndex >= 0 && /\b(stop|exit|end|cancel)\b/i.test(question)) {
      bubble('visitor', question);
      endTour();
      bubble('nova', 'Tour ended. You can still ask about any section.');
      return;
    }
    if (tourIndex >= 0 && /\b(next|continue|forward)\b/i.test(question)) {
      if (tourIndex === destinations.length - 1) {
        bubble('visitor', question);
        endTour();
        bubble('nova', `That is the tour of ${site.title}! Ask me about any section whenever you like.`);
      } else visitTour(tourIndex + 1, question);
      return;
    }
    if (tourIndex >= 0 && /\b(back|previous)\b/i.test(question)) {
      if (tourIndex > 0) visitTour(tourIndex - 1, question);
      else { bubble('visitor', question); bubble('nova', 'You are already at the first stop.'); }
      return;
    }
    if (/\b(tour|walk.?through|show me around|show me the site)\b/i.test(question)) {
      if (destinations.length) visitTour(0, question);
      else { bubble('visitor', question); bubble('nova', 'There are no guide stops on this page yet.'); }
      return;
    }
    const previousDialogue = history.slice(-8);
    bubble('visitor', question);
    startGesture('think', 15000);
    status.textContent = 'Thinking…';
    post('question', { question, history: previousDialogue, requestId: beginPending() });
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
    if (pending) clearPending();
    tourIndex = -1;
    updateTourControls();
    post('clearHighlight');
  }

  function visitTour(index, requestedText = null) {
    if (pending || index < 0 || index >= destinations.length) return;
    tourIndex = index;
    const item = destinations[index];
    bubble('visitor', requestedText || `Show me ${item.label}`);
    status.textContent = 'Finding section…';
    post('navigate', { key: item.key, requestId: beginPending() });
  }

  startTour.addEventListener('click', () => {
    if (!destinations.length) { bubble('nova', 'There are no guide stops on this page yet.'); return; }
    visitTour(0);
  });
  tourPrevious.addEventListener('click', () => visitTour(tourIndex - 1));
  tourNext.addEventListener('click', () => {
    if (tourIndex === destinations.length - 1) {
      endTour();
      bubble('nova', `That is the tour of ${site.title}! Ask me about any section whenever you like.`);
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
  sendButton.addEventListener('click', (event) => {
    if (!pending || input.value.trim()) return;
    event.preventDefault();
    clearPending();
    status.textContent = 'Ready to guide';
    bubble('nova', 'Stopped. Ask me something else whenever you like.');
  });
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
    if (event.data.type === 'hostAsk') {
      document.body.classList.remove('compact');
      restore.hidden = true;
      if (typeof event.data.question === 'string') ask(event.data.question.trim().slice(0, 500));
    } else if (event.data.type === 'init') {
      const incomingSite = event.data.site;
      if (incomingSite && typeof incomingSite.title === 'string') site = {
        title: incomingSite.title.slice(0, 100),
        description: typeof incomingSite.description === 'string' ? incomingSite.description.slice(0, 360) : '',
        headline: typeof incomingSite.headline === 'string' ? incomingSite.headline.slice(0, 120) : ''
      };
      const incomingPersonality = event.data.personality;
      if (incomingPersonality && typeof incomingPersonality.name === 'string') personality = {
        name: incomingPersonality.name.slice(0, 32),
        tone: ['friendly', 'professional', 'playful'].includes(incomingPersonality.tone) ? incomingPersonality.tone : 'friendly'
      };
      document.querySelector('.panel-heading strong').textContent = personality.name;
      document.title = `${personality.name} guide`;
      actor.setAttribute('aria-label', `Wave to ${personality.name}`);
      document.querySelector('.reaction-menu').setAttribute('aria-label', `${personality.name}'s moves`);
      document.querySelector('.panel').setAttribute('aria-label', `Chat with ${personality.name}`);
      document.querySelector('#questionForm label').textContent = `Ask ${personality.name}`;
      restore.setAttribute('aria-label', `Open ${personality.name} guide`);
      if (!messages.children.length) bubble('nova', typeof event.data.greeting === 'string'
        ? event.data.greeting.slice(0, 420) : `Hi! I'm ${personality.name}. I can help you explore ${site.title}.`);
      prompts.replaceChildren();
      const currentKey = destinations[tourIndex]?.key;
      destinations = (Array.isArray(event.data.targets) ? event.data.targets : [])
        .filter((item) => typeof item?.key === 'string' && typeof item?.label === 'string').slice(0, 12);
      if (tourIndex >= 0) tourIndex = destinations.findIndex((item) => item.key === currentKey);
      updateTourControls();
      for (const item of destinations.slice(0, 4)) {
        if (typeof item?.key !== 'string') continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `Show ${item.label}`;
        button.addEventListener('click', () => ask(`Show me ${item.key}`));
        prompts.append(button);
      }
    } else if (event.data.type === 'reply' || event.data.type === 'navigated') {
      if (!pending || event.data.requestId !== activeRequestId) return;
      clearPending();
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
