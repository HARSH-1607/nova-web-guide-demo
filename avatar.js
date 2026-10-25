(() => {
  'use strict';

  const FRAME_WIDTH = 384;
  const FRAME_HEIGHT = 512;
  const SOURCE_WIDTH = 256;
  const SOURCE_HEIGHT = 342;
  const atlasFiles = {
    walkFluid: 'walk-fluid.webp',
    pointFluid: 'point-fluid.webp',
    waveFluid: 'wave-fluid.webp',
    danceFluid: 'dance-fluid.webp',
    joyFluid: 'joy-fluid.webp',
    speechFluid: 'speech-fluid.webp'
  };
  const fluidFrameCounts = {
    walkFluid: 36, pointFluid: 37, waveFluid: 41,
    danceFluid: 48, joyFluid: 41, speechFluid: 56
  };
  const FACE_TARGET_X = 192;
  const FACE_TARGET_Y = 88;
  const WALK_HALF_DURATION_MS = 1050;
  const WALK_SPEED = 140;

  const actor = document.getElementById('avatarActor');
  const canvas = document.getElementById('avatarCanvas');
  const status = document.getElementById('avatarStatus');
  const voiceSelect = document.getElementById('voiceSelect');
  const voiceNotice = document.getElementById('voiceNotice');
  const modelSelect = document.getElementById('modelSelect');
  const aiProvider = document.getElementById('aiProvider');
  const localModelRow = document.getElementById('localModelRow');
  const modelNotice = document.getElementById('modelNotice');
  const chatHistory = document.getElementById('chatHistory');
  const speechInput = document.getElementById('speechText');
  const askButton = document.getElementById('askButton');
  const guideHint = document.getElementById('guideHint');
  const skipGuideInline = document.getElementById('skipGuideInline');
  const guideHintText = document.getElementById('guideHintText');
  const guidePointer = document.getElementById('guidePointer');
  const guidePointerLine = document.getElementById('guidePointerLine');
  const context = canvas.getContext('2d', { alpha: true });
  const faceLayer = document.createElement('canvas');
  faceLayer.width = FRAME_WIDTH;
  faceLayer.height = FRAME_HEIGHT;
  const faceContext = faceLayer.getContext('2d', { alpha: true });
  const images = {};
  let availableVoices = [];
  let elevenVoices = [];
  let selectedVoice = null;
  let naturalVoiceAvailable = false;
  let naturalVoiceProvider = null;
  let voiceChoiceTouched = false;
  let conversation = [];
  let chatRequestInFlight = false;
  let chatRequestController = null;
  let onlineAvailable = false;
  let localAvailable = false;
  let onDeviceAvailable = false;
  let providerChoiceTouched = false;
  let onlineModel = '';
  let providersChecked = false;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const state = {
    x: 0, y: 0, destination: null, onArrival: null,
    gesture: null, speech: null, pendingSpeech: null, blinkUntil: 0, nextBlink: 0,
    lastTick: 0, ready: false, walkStarted: 0, guide: null,
    pointer: { x: 0, y: 0, active: false }, intro: true, teleportVersion: 0,
    currentFrame: null, previousFrame: null, frameChangedAt: 0
  };

  function setStatus(message) { status.textContent = message; }
  function cancelChatRequest() {
    if (!chatRequestController) return;
    chatRequestController.abort();
    chatRequestController = null;
    chatRequestInFlight = false;
    askButton.disabled = false;
    askButton.textContent = 'Ask';
    askButton.setAttribute('aria-label', 'Ask Dork');
  }
  function revealSite() {
    if (!state.intro) return;
    state.intro = false;
    document.body.classList.remove('intro-active');
    document.querySelectorAll('.site-header, main, .site-footer').forEach((section) => { section.inert = false; });
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (!state.guide && !state.destination) Object.assign(state, dockPosition());
    placeActor();
    window.dispatchEvent(new Event('nova:reveal'));
  }
  window.addEventListener('pointermove', (event) => {
    state.pointer.x = event.clientX;
    state.pointer.y = event.clientY;
    state.pointer.active = true;
  }, { passive: true });
  window.addEventListener('blur', () => { state.pointer.active = false; });
  document.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) state.pointer.active = false;
  });
  function updateVoiceNotice() {
    voiceNotice.textContent = selectedVoice?.name === 'Google UK English Male'
      ? 'Google UK English Male is ready. Speech starts in your browser without audio generation.'
      : 'Dork uses the best available English male browser voice. Google UK English Male appears here when your browser provides it.';
  }
  function renderVoiceOptions() {
    const previous = voiceSelect.value;
    const browserGroup = document.createElement('optgroup');
    browserGroup.label = 'Instant browser voices';
    if (availableVoices.length) {
      availableVoices.forEach((voice, index) => {
        browserGroup.append(new Option(`${voice.name} (${voice.lang})`, `browser:${index}`));
      });
    } else {
      browserGroup.append(new Option('System default', 'browser:default'));
    }
    voiceSelect.replaceChildren(browserGroup);
    voiceSelect.value = voiceChoiceTouched && [...voiceSelect.options].some((option) => option.value === previous)
      ? previous : availableVoices.length ? 'browser:0' : 'browser:default';
    const browserIndex = Number(voiceSelect.value.split(':')[1]);
    selectedVoice = voiceSelect.value.startsWith('browser:') ? availableVoices[browserIndex] || null : null;
  }

  function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices()
      .filter((voice) => voice.lang.toLowerCase().startsWith('en'));
    availableVoices = window.DorkVoice.rank(voices);
    renderVoiceOptions();
    updateVoiceNotice();
  }

  async function loadElevenVoices() {
    try {
      const response = await fetch('/api/voices', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load ElevenLabs voices.');
      elevenVoices = (result.voices || []).sort((a, b) => {
        const aMale = a.gender?.toLowerCase() === 'male' ? 1 : 0;
        const bMale = b.gender?.toLowerCase() === 'male' ? 1 : 0;
        return bMale - aMale || a.name.localeCompare(b.name);
      });
      renderVoiceOptions();
      updateVoiceNotice();
    } catch (error) {
      updateVoiceNotice();
    }
  }

  function updateProviderNotice() {
    const provider = aiProvider.value;
    localModelRow.hidden = provider !== 'local';
    modelNotice.classList.toggle('error', provider === 'device' ? !onDeviceAvailable : provider === 'online' ? !onlineAvailable : !localAvailable);
    modelNotice.textContent = provider === 'device'
      ? onDeviceAvailable ? 'On-device AI ready. The first question may download a model to your browser.' : 'On-device AI is unavailable on this browser or device.'
      : provider === 'online' ? onlineAvailable ? `Online AI ready · ${onlineModel}. Provider quota applies.` : 'Online AI is not configured.'
        : localAvailable ? `Local Ollama ready · ${modelSelect.value}` : 'Ollama is unavailable or has no models.';
  }

  function mainAiContext() {
    return {
      site: { title: document.title, description: document.querySelector('meta[name="description"]')?.content || 'Aura is a prototype website for an interactive character guide.' },
      personality: { name: 'Dork', tone: 'friendly', instructions: 'Be warm, concise, and honest about placeholder features and prices.' },
      targets: [...document.querySelectorAll('[data-guide-spot]')].slice(0, 12).map((element) => ({
        key: element.dataset.guideSpot, label: element.querySelector('h1,h2,h3')?.textContent?.trim().slice(0, 80) || element.dataset.guideSpot,
        description: element.dataset.guideDescription || ''
      }))
    };
  }

  async function loadAIProviders() {
    modelNotice.classList.remove('error');
    modelNotice.textContent = 'Checking AI connections…';
    onDeviceAvailable = Boolean(window.DorkLocalAI) && (await window.DorkLocalAI.availability()) !== 'unavailable';
    aiProvider.querySelector('[value="device"]').disabled = !onDeviceAvailable;
    try {
      const response = await fetch('/api/online/status', { cache: 'no-store' });
      const result = await response.json();
      onlineAvailable = response.ok && result.available === true;
      onlineModel = typeof result.model === 'string' ? result.model : '';
    } catch { onlineAvailable = false; }
    try {
      const response = await fetch('/api/embed/status', { cache: 'no-store' });
      const result = response.ok ? await response.json() : null;
      naturalVoiceAvailable = Boolean(result?.naturalVoice);
      naturalVoiceProvider = result?.voiceProvider || null;
      renderVoiceOptions();
      updateVoiceNotice();
    } catch { naturalVoiceAvailable = false; naturalVoiceProvider = null; updateVoiceNotice(); }
    try {
      const response = await fetch('/api/llm/models', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not reach Ollama.');
      const previous = modelSelect.value;
      const models = Array.isArray(result.models) ? result.models : [];
      modelSelect.replaceChildren(...models.map((model) => new Option(model, model)));
      if (models.includes(previous)) modelSelect.value = previous;
      localAvailable = models.length > 0;
      if (!models.length) {
        modelSelect.append(new Option('No models installed', ''));
      }
    } catch (error) {
      localAvailable = false;
      modelSelect.replaceChildren(new Option('Ollama unavailable', ''));
    }
    if (!providerChoiceTouched) aiProvider.value = onlineAvailable ? 'online' : onDeviceAvailable ? 'device' : localAvailable ? 'local' : 'online';
    if (aiProvider.value === 'device') {
      if (!voiceChoiceTouched) voiceSelect.value = [...voiceSelect.options].find((option) => option.value.startsWith('browser:'))?.value || 'browser:default';
    }
    providersChecked = true;
    updateProviderNotice();
  }

  function addChatBubble(role, message) {
    chatHistory.querySelector('.chat-empty')?.remove();
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.textContent = message;
    chatHistory.append(bubble);
    while (chatHistory.children.length > 20) chatHistory.firstElementChild.remove();
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  const guideSteps = {
    features: { target: 'features', text: 'Let me show you speech motion. Click the glowing “Hear the vowels” button.', done: 'Ah. Eh. Ee. Oh. Oo. Those sounds drive my approximate mouth motion.' },
    pricing: { target: 'pricing', text: 'Here is the pricing section. Click “Ask about plans” to learn what is available in this prototype.', done: 'These plans are placeholders. There are no live prices yet.' },
    contact: { target: 'contact', text: 'Here is the last stop. Click “Finish the tour” to complete the walkthrough.', done: 'That is the tour! Ask me a question any time.' }
  };

  function classifyGuideRequest(message) {
    if (/\b(tour|walk.?through|show me (the |this )?(site|website|around)|how (do i|to) use (this|the) (site|website))\b/i.test(message)) return 'tour';
    if (/\b(pric(?:e|es|ing)|cost|plans?)\b/i.test(message)) return 'pricing';
    if (/\b(feature|speech|lip.?sync|vowel)\b/i.test(message)) return 'features';
    if (/\b(contact|finish|last stop)\b/i.test(message)) return 'contact';
    return null;
  }

  const gestureResponses = {
    wave: 'Hello! Here is a wave.', nod: 'Yes, I am listening.',
    shake: 'Not quite. Let us try another way.', think: 'Hmm. Let me think about that.',
    fistBump: 'Fist bump! We make a good team.', jump: 'Here we go!',
    dance: 'Let me show you my dance.', joy: 'Let us celebrate!'
  };

  function classifyActionRequest(message) {
    const patterns = [
      ['wave', /\b(wave|say hi|hello)\b/i], ['dance', /\b(dance|dancing)\b/i],
      ['joy', /\b(celebrate|joy|happy)\b/i], ['nod', /\b(nod|agree with me)\b/i],
      ['shake', /\b(shake your head|say no|disagree)\b/i],
      ['fistBump', /\b(fist.?bump|high.?five)\b/i], ['jump', /\b(jump|hop)\b/i],
      ['think', /\b(think pose|look thoughtful|thinking animation)\b/i]
    ];
    const gesture = patterns.find(([, pattern]) => pattern.test(message))?.[0];
    if (gesture) return { gesture, reply: gestureResponses[gesture] };
    return null;
  }

  const workflowContent = {
    listen: { badge: 'STEP 01 · LISTEN', title: 'Start with a question.', text: '“Where can I learn about pricing?” is enough. Dork can recognize this page’s named destinations without needing an AI response first.' },
    guide: { badge: 'STEP 02 · GUIDE', title: 'See the destination.', text: 'Dork scrolls to the right section, teleports next to it, and points with a visible highlight and guide line.' },
    confirm: { badge: 'STEP 03 · CONFIRM', title: 'Finish with your click.', text: 'Dork waits while the visitor chooses the highlighted button. The tour then moves to the next step or returns home.' }
  };

  function setWorkflowStep(name) {
    const content = workflowContent[name];
    if (!content) return;
    document.querySelectorAll('[data-workflow-step]').forEach((button) => {
      const active = button.dataset.workflowStep === name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.getElementById('workflowBadge').textContent = content.badge;
    document.getElementById('workflowPreviewTitle').textContent = content.title;
    document.getElementById('workflowPreviewText').textContent = content.text;
  }

  function setIntegrationFilter(name) {
    document.querySelectorAll('[data-integration-filter]').forEach((button) => {
      const active = button.dataset.integrationFilter === name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-integration-category]').forEach((card) => {
      card.hidden = name !== 'all' && card.dataset.integrationCategory !== name;
    });
  }

  function findLandmark(message) {
    const normalized = message.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!/\b(go|take|navigate|move|show|find|where|tell|explain|about|what|logo|faq|workflow|integrations|trust|home)\b/.test(normalized)) return null;
    let best = null;
    let score = 0;
    document.querySelectorAll('[data-guide-spot]').forEach((element) => {
      const aliases = [element.dataset.guideSpot, ...(element.dataset.guideAliases || '').split(',')];
      aliases.forEach((alias) => {
        const term = alias.trim().toLowerCase();
        if (term.length > score && (` ${normalized} `).includes(` ${term} `)) {
          best = element;
          score = term.length;
        }
      });
    });
    return best;
  }

  function dockPosition() {
    const size = actorSize();
    const panel = document.querySelector('.control-panel').getBoundingClientRect();
    return clampPosition(window.innerWidth - size.width - 34, Math.max(14, panel.top - size.height - 10));
  }

  function introPosition() {
    const size = actorSize();
    const panel = document.querySelector('.control-panel').getBoundingClientRect();
    return {
      x: Math.max(0, (window.innerWidth - size.width) / 2),
      y: Math.max(window.innerWidth <= 600 ? 175 : window.innerHeight < 680 ? 120 : 135, panel.top - size.height - 12)
    };
  }

  function guidedPosition(target) {
    const rect = target.getBoundingClientRect();
    const size = actorSize();
    if (window.innerWidth < 700) {
      const panel = document.querySelector('.control-panel').getBoundingClientRect();
      return { x: window.innerWidth - size.width - 12, y: Math.max(8, panel.top - size.height + 12) };
    }
    const fitsRight = rect.right + size.width + 24 < window.innerWidth;
    return {
      x: fitsRight ? rect.right + 18 : rect.left - size.width - 18,
      y: rect.top + rect.height / 2 - size.height * 0.53
    };
  }

  function clearGuideVisuals() {
    document.querySelector('.guide-target-active')?.classList.remove('guide-target-active');
    guideHint.hidden = true;
    guidePointer.hidden = true;
  }

  function positionGuideHint() {
    const width = guideHint.offsetWidth;
    const height = guideHint.offsetHeight;
    const roomAbove = state.y - height - 8 >= 12;
    const x = roomAbove ? state.x : window.innerWidth - width - 12;
    guideHint.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, x))}px`;
    guideHint.style.top = `${roomAbove ? state.y - height - 8 : window.innerWidth >= 700 ? 88 : 12}px`;
  }

  function endGuide(returnToDock = true) {
    if (state.guide) state.guide.cancelled = true;
    state.guide = null;
    skipGuideInline.hidden = true;
    state.teleportVersion += 1;
    actor.classList.remove('teleport-out', 'teleport-in');
    actor.style.opacity = '';
    actor.style.transition = '';
    state.destination = null;
    state.onArrival = null;
    state.gesture = null;
    clearGuideVisuals();
    if (returnToDock) {
      const dock = dockPosition();
      walkTo(dock.x, dock.y, null, true);
    }
  }

  function beginGuide(request) {
    cancelChatRequest();
    endGuide(false);
    const steps = request === 'tour' ? ['features', 'pricing', 'contact'] : [request];
    state.guide = { steps, index: 0, cancelled: false, awaiting: false, tour: request === 'tour' };
    skipGuideInline.hidden = false;
    showGuideStep();
  }

  function showLandmark(element) {
    cancelChatRequest();
    endGuide(false);
    window.dispatchEvent(new CustomEvent('nova:guide-target', { detail: { element } }));
    if (element.matches('[data-integration-category]')) setIntegrationFilter(element.dataset.integrationCategory);
    const focus = element.querySelector('h1,h2,h3') || element;
    const guide = { cancelled: false, awaiting: false, targetElement: focus, landmark: true };
    state.guide = guide;
    skipGuideInline.hidden = false;
    const description = element.dataset.guideDescription || `Here is ${element.dataset.guideSpot}.`;
    addChatBubble('assistant', description);
    transitionToTarget(element, focus, () => {
      if (state.guide !== guide || guide.cancelled) return;
      guide.awaiting = true;
      focus.classList.add('guide-target-active');
      guidePointer.hidden = false;
      guideHintText.textContent = description;
      guideHint.hidden = false;
      positionGuideHint();
      speak(description, true);
      startGesture('point', true);
      window.setTimeout(() => { if (state.guide === guide) endGuide(); }, Math.max(6000, description.length * 65));
    }, window.innerWidth < 700 && element.matches('.cinematic-scene') ? 'start' : 'center');
  }

  function showGuideStep() {
    const guide = state.guide;
    if (!guide || guide.cancelled) return;
    clearGuideVisuals();
    guide.awaiting = false;
    const step = guideSteps[guide.steps[guide.index]];
    const target = document.querySelector(`[data-walkthrough-target="${step.target}"]`);
    if (!target) { endGuide(); return; }
    window.dispatchEvent(new CustomEvent('nova:guide-target', { detail: { element: target } }));
    guide.targetElement = target;
    const instruction = step.text;
    addChatBubble('assistant', instruction);
    transitionToTarget(target, target, () => {
      if (state.guide !== guide || guide.cancelled) return;
      guide.awaiting = true;
      target.classList.add('guide-target-active');
      guidePointer.hidden = false;
      guideHintText.textContent = `Step ${guide.index + 1}/${guide.steps.length}: ${instruction}`;
      guideHint.hidden = false;
      positionGuideHint();
      speak(instruction, true);
      startGesture('point', true);
    });
  }

  function completeGuideStep(target) {
    const guide = state.guide;
    const step = guide?.steps && guideSteps[guide.steps[guide.index]];
    if (!step || !guide.awaiting || target.dataset.walkthroughTarget !== step.target) return false;
    guide.awaiting = false;
    clearGuideVisuals();
    addChatBubble('assistant', step.done);
    speak(step.done, true);
    if (step.target === 'contact') startGesture('joy', true);
    window.setTimeout(() => {
      if (state.guide !== guide || guide.cancelled) return;
      guide.index += 1;
      if (guide.index < guide.steps.length) showGuideStep();
      else if (guide.tour) {
        endGuide();
        document.body.classList.add('journey-complete');
        window.dispatchEvent(new Event('nova:tour-complete'));
        const finished = 'The tour is complete. Keep exploring any part of the website!';
        addChatBubble('assistant', finished);
        speak(finished, true);
      } else endGuide();
    }, 1800);
    return true;
  }

  function updateGuidePointer() {
    const guide = state.guide;
    if (!guide?.awaiting) return;
    const target = guide.targetElement;
    if (!target) return;
    const from = actor.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    guidePointerLine.setAttribute('x1', String(from.left + from.width * 0.5));
    guidePointerLine.setAttribute('y1', String(from.top + from.height * 0.48));
    guidePointerLine.setAttribute('x2', String(to.left + to.width * 0.5));
    guidePointerLine.setAttribute('y2', String(to.top + to.height * 0.5));
  }

  async function askAI() {
    const message = speechInput.value.trim();
    if (!message) {
      if (chatRequestInFlight) {
        cancelChatRequest();
        state.gesture = null;
        setStatus('Ready to guide');
        addChatBubble('assistant', 'Stopped. What would you like to explore next?');
      }
      return;
    }
    if (chatRequestInFlight) cancelChatRequest();
    if (/^(stop|cancel|skip)(?: (?:the )?(?:tour|walkthrough))?[.!]?$/i.test(message)) {
      addChatBubble('user', message);
      speechInput.value = '';
      endGuide();
      addChatBubble('assistant', 'Okay, I stopped the walkthrough. Ask me when you want to start again.');
      speak('Okay, I stopped the walkthrough.', true);
      return;
    }
    if (/\b(enter|open|explore|browse)\b.*\b(site|website|page)\b/i.test(message)) {
      addChatBubble('user', message);
      speechInput.value = '';
      revealSite();
      const reply = 'Welcome in! Tell me where you want to go, or ask me to show you the site.';
      addChatBubble('assistant', reply);
      speak(reply, true);
      return;
    }
    if (state.intro && /\b(what can you do|how can you help|what do you do)\b/i.test(message)) {
      addChatBubble('user', message);
      speechInput.value = '';
      const reply = 'I can answer questions, guide you to features or pricing, and point out buttons. You can explore the site whenever it opens. Try saying show me the site!';
      addChatBubble('assistant', reply);
      speak(reply, true);
      startGesture('point', true);
      return;
    }
    const guideRequest = classifyGuideRequest(message);
    if (guideRequest) {
      addChatBubble('user', message);
      speechInput.value = '';
      revealSite();
      beginGuide(guideRequest);
      return;
    }
    const actionRequest = classifyActionRequest(message);
    if (actionRequest) {
      const wasGuiding = Boolean(state.guide);
      endGuide(wasGuiding);
      addChatBubble('user', message);
      addChatBubble('assistant', actionRequest.reply);
      speechInput.value = '';
      speak(actionRequest.reply, wasGuiding);
      if (wasGuiding) state.onArrival = () => startGesture(actionRequest.gesture, true);
      else startGesture(actionRequest.gesture, true);
      return;
    }
    const landmark = findLandmark(message);
    if (landmark) {
      addChatBubble('user', message);
      speechInput.value = '';
      revealSite();
      showLandmark(landmark);
      return;
    }
    const wasGuiding = Boolean(state.guide);
    endGuide(wasGuiding);
    const provider = aiProvider.value;
    const useOnline = provider === 'online';
    if (providersChecked && !(provider === 'device' ? onDeviceAvailable : useOnline ? onlineAvailable : localAvailable)) {
      addChatBubble('user', message);
      speechInput.value = '';
      const help = 'AI chat is unavailable right now. I can still show you the site, pricing, features, contact, or a guided tour. Choose an available AI provider in settings to ask open questions.';
      addChatBubble('assistant', help);
      modelNotice.classList.add('error');
      updateProviderNotice();
      setStatus('Ready to guide');
      startGesture('point', true);
      return;
    }
    chatRequestInFlight = true;
    const requestController = new AbortController();
    chatRequestController = requestController;
    askButton.textContent = 'Stop';
    askButton.setAttribute('aria-label', 'Stop or replace response');
    addChatBubble('user', message);
    speechInput.value = '';
    startGesture('think', true);
    setStatus('Thinking…');
    modelNotice.classList.remove('error');
    modelNotice.textContent = provider === 'device' ? 'Dork is thinking on this device…' : useOnline ? 'Dork is thinking online…' : 'Dork is thinking on your local model…';
    try {
      let result;
      if (provider === 'device') {
        const reply = await window.DorkLocalAI.answer(message, mainAiContext(), requestController.signal,
          (percent) => { if (chatRequestController === requestController) modelNotice.textContent = `Downloading on-device model… ${percent}%`; });
        result = { reply, model: 'On-device AI' };
      } else {
        const response = await fetch(useOnline ? '/api/online/chat' : '/api/llm/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, model: modelSelect.value, history: conversation.slice(-8) }),
          signal: requestController.signal, cache: 'no-store'
        });
        result = await response.json();
        if (!response.ok) throw new Error(result.error || 'The AI could not answer.');
      }
      if (chatRequestController !== requestController) return;
      addChatBubble('assistant', result.reply);
      conversation.push({ role: 'user', content: message }, { role: 'assistant', content: result.reply });
      conversation = conversation.slice(-8);
      modelNotice.textContent = `Answered by ${result.model} · voice: ${voiceSelect.selectedOptions[0]?.textContent || 'browser'}`;
      state.gesture = null;
      speak(result.reply, wasGuiding);
    } catch (error) {
      if (requestController.signal.aborted || chatRequestController !== requestController) return;
      state.gesture = null;
      const detail = error.message || 'Could not contact the AI.';
      addChatBubble('assistant', `I could not answer: ${detail}`);
      modelNotice.classList.add('error');
      modelNotice.textContent = detail;
      setStatus('AI unavailable');
    } finally {
      if (chatRequestController === requestController) cancelChatRequest();
    }
  }
  function actorSize() { return { width: actor.offsetWidth, height: actor.offsetHeight }; }
  function clampPosition(x, y) {
    const { width, height } = actorSize();
    const position = {
      x: Math.max(0, Math.min(window.innerWidth - width, x)),
      y: Math.max(0, Math.min(window.innerHeight - height, y))
    };
    const panel = document.querySelector('.control-panel').getBoundingClientRect();
    const overlapsPanel = !(window.innerWidth < 700 && state.guide)
      && position.x < panel.right && position.x + width > panel.left
      && position.y < panel.bottom && position.y + height > panel.top;
    if (overlapsPanel) {
      if (panel.top - height - 12 >= 0) position.y = panel.top - height - 12;
      else position.x = Math.max(0, panel.left - width - 12);
    }
    return position;
  }
  function placeActor(now = performance.now()) {
    const walking = Boolean(state.destination);
    const gesture = state.gesture;
    const dancing = gesture?.type === 'dance';
    const walkPhase = (now - state.walkStarted) * Math.PI * 2 / WALK_HALF_DURATION_MS;
    const gestureElapsed = gesture ? Math.max(0, now - gesture.started) : 0;
    const gestureEnvelope = gesture ? Math.min(1, gestureElapsed / 250, (gesture.duration - gestureElapsed) / 300) : 0;
    const dancePhase = gesture ? gestureElapsed * Math.PI * 2 / 2000 : 0;
    let bob = walking ? Math.sin(walkPhase) * 1.5
      : dancing ? Math.sin(dancePhase) * 3.2 : Math.sin(now * 0.0017) * 1.1;
    let sway = dancing ? Math.sin(dancePhase) * 2.3 : Math.sin(now * 0.0009) * 0.22;
    const groove = dancing ? Math.sin(dancePhase) * 3.5 : 0;
    if (gesture?.type === 'wave') {
      sway += Math.sin(gestureElapsed * Math.PI * 2 / 850) * 0.7 * gestureEnvelope;
      bob += Math.sin(gestureElapsed * Math.PI * 2 / 1250) * 0.7 * gestureEnvelope;
    } else if (gesture?.type === 'point') {
      sway += 0.7 * gestureEnvelope;
    } else if (gesture?.type === 'joy') {
      bob -= Math.sin(Math.PI * gestureElapsed / gesture.duration) * 2.4;
      sway += Math.sin(gestureElapsed * Math.PI * 2 / 1200) * 0.8 * gestureEnvelope;
    }
    actor.style.transform = `translate3d(${(state.x + groove).toFixed(1)}px, ${(state.y + bob).toFixed(1)}px, 0) rotate(${sway.toFixed(2)}deg)`;
  }

  function drawAlignedFrame(sheet, frame, opacity = 1, flip = false, target = context) {
    const image = images[sheet];
    if (!image) return;
    const safeFrame = Math.max(0, Math.min(fluidFrameCounts[sheet] - 1, frame));
    target.save();
    if (flip) {
      target.translate(FRAME_WIDTH, 0);
      target.scale(-1, 1);
    }
    target.globalAlpha = opacity;
    target.drawImage(image, (safeFrame % 4) * SOURCE_WIDTH,
      Math.floor(safeFrame / 4) * SOURCE_HEIGHT,
      SOURCE_WIDTH, SOURCE_HEIGHT, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    target.restore();
  }

  function drawFaceOverlay(sheet, frame, opacity) {
    if (opacity <= 0 || frame % 7 === 0) return;
    faceContext.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    drawAlignedFrame(sheet, frame, 1, false, faceContext);
    faceContext.save();
    faceContext.globalCompositeOperation = 'destination-in';
    const blink = frame === 55;
    const centerY = blink ? FACE_TARGET_Y - 15 : FACE_TARGET_Y + 23;
    const gradient = faceContext.createRadialGradient(FACE_TARGET_X, centerY, 9,
      FACE_TARGET_X, centerY, blink ? 30 : 27);
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(0.65, 'rgba(0,0,0,1)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    faceContext.fillStyle = gradient;
    faceContext.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    faceContext.restore();
    context.save();
    context.globalAlpha = opacity;
    context.drawImage(faceLayer, 0, 0);
    context.restore();
  }

  function drawFrame(sheet, frame, now, flip = false) {
    if (window.Nova3D?.ready) return;
    const next = { sheet, frame, flip };
    const current = state.currentFrame;
    const unchanged = current && current.sheet === sheet && current.frame === frame && current.flip === flip;
    if (unchanged && (sheet !== 'speechFluid' || now - state.frameChangedAt >= 50)) return;
    if (!unchanged) {
      state.previousFrame = current;
      state.currentFrame = next;
      state.frameChangedAt = now;
    }
    context.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    if (sheet === 'speechFluid') {
      drawAlignedFrame('speechFluid', 0);
      const previous = state.previousFrame;
      const canBlendFace = previous?.sheet === 'speechFluid';
      const fade = canBlendFace ? Math.min(1, (now - state.frameChangedAt) / 50) : 1;
      const eased = fade * fade * (3 - 2 * fade);
      if (canBlendFace && fade < 1) drawFaceOverlay(previous.sheet, previous.frame, 1 - eased);
      drawFaceOverlay(sheet, frame, eased);
    } else {
      // Complete-body dissolves make duplicate hands and feet; crisp pose changes look cleaner.
      drawAlignedFrame(sheet, frame, 1, flip);
    }
  }

  function walkTo(x, y, onArrival, keepSpeech = false) {
    if (!keepSpeech) cancelSpeech();
    state.destination = clampPosition(x, y);
    state.walkStarted = performance.now();
    state.onArrival = onArrival || null;
    state.gesture = null;
    setStatus('Guiding you');
  }

  function teleportBurst() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const burst = document.createElement('div');
    burst.className = 'teleport-burst';
    burst.style.left = `${state.x + actor.offsetWidth * 0.5}px`;
    burst.style.top = `${state.y + actor.offsetHeight * 0.52}px`;
    document.body.append(burst);
    window.setTimeout(() => burst.remove(), 750);
  }

  function transitionToTarget(scrollTarget, focus, onArrival, block = 'center') {
    const version = ++state.teleportVersion;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.destination = null;
    state.onArrival = null;
    state.gesture = null;
    actor.classList.remove('teleport-in');
    setStatus('Teleporting to your destination');
    if (!reducedMotion) teleportBurst();
    actor.classList.add('teleport-out');
    const fadeStarted = performance.now();
    function afterFade(now) {
      if (version !== state.teleportVersion) return;
      if (!reducedMotion && Number(getComputedStyle(actor).opacity) > 0.03) {
        if (now - fadeStarted < 1200) {
          requestAnimationFrame(afterFade);
          return;
        }
        actor.style.transition = 'none';
        actor.style.opacity = '0';
        requestAnimationFrame(beginScroll);
        return;
      }
      beginScroll();
    }
    function beginScroll() {
      if (version !== state.teleportVersion) return;
      scrollTarget.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block });
      const started = performance.now();
      let previousScroll = window.scrollY;
      let stableFrames = 0;
      function afterScroll(now) {
        if (version !== state.teleportVersion) return;
        const movement = Math.abs(window.scrollY - previousScroll);
        stableFrames = movement < 0.75 ? stableFrames + 1 : 0;
        previousScroll = window.scrollY;
        if (!reducedMotion && (now - started < 220 || stableFrames < 6) && now - started < 2500) {
          requestAnimationFrame(afterScroll);
          return;
        }
        const position = guidedPosition(focus);
        const destination = clampPosition(position.x, position.y);
        state.x = destination.x;
        state.y = destination.y;
        placeActor();
        actor.classList.remove('teleport-out');
        actor.style.opacity = '';
        actor.style.transition = '';
        if (!reducedMotion) {
          actor.classList.add('teleport-in');
          teleportBurst();
          startGesture('wave', true);
        }
        window.setTimeout(() => {
          if (version !== state.teleportVersion) return;
          actor.classList.remove('teleport-in');
          onArrival?.();
        }, reducedMotion ? 0 : 620);
      }
      requestAnimationFrame(afterScroll);
    }
    requestAnimationFrame(afterFade);
  }

  function startGesture(type, keepSpeech = false) {
    const duration = { point: 2200, wave: 2500, dance: 4000, joy: 2400,
      nod: 1900, shake: 1900, think: 2300, fistBump: 1700, jump: 2000 }[type];
    if (!duration) return;
    if (!keepSpeech) cancelSpeech();
    state.destination = null;
    state.onArrival = null;
    state.gesture = { type, started: performance.now(), duration };
    setStatus({ point: 'Pointing', wave: 'Waving', dance: 'Dancing', joy: 'Feeling joyful',
      nod: 'Nodding', shake: 'Shaking my head', think: 'Thinking', fistBump: 'Fist bump', jump: 'Jumping' }[type]);
  }

  function vowelFrame(character) {
    switch (character.toLowerCase()) {
      case 'a': return 1;
      case 'e': return 2;
      case 'i':
      case 'y': return 3;
      case 'o': return 4;
      case 'u': return 5;
      case 'm':
      case 'b':
      case 'p': return 6;
      default: return 0;
    }
  }

  function speechPose(now) {
    const speech = state.speech;
    if (!speech) return ['speechFluid', 0];
    const elapsed = Math.max(0, now - speech.started);
    let characterIndex;
    const starts = speech.alignment?.character_start_times_seconds;
    if (speech.audio && Array.isArray(starts) && starts.length) {
      const playbackTime = speech.audio.currentTime;
      let low = 0;
      let high = starts.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (starts[middle] <= playbackTime) low = middle + 1;
        else high = middle;
      }
      characterIndex = Math.max(0, low - 1);
    } else {
      const playbackFraction = speech.audio && Number.isFinite(speech.audio.duration) && speech.audio.duration > 0
        ? speech.audio.currentTime / speech.audio.duration : elapsed / speech.estimatedDuration;
      const estimatedIndex = playbackFraction * speech.text.length;
      const boundaryIndex = speech.boundaryIndex + Math.max(0, now - speech.boundaryAt) / 125;
      characterIndex = Math.min(speech.text.length - 1,
        speech.hasBoundary ? boundaryIndex : estimatedIndex);
    }
    let cueIndex = 0;
    for (let index = 1; index < speech.mouthCues.length; index++) {
      if (speech.mouthCues[index].characterIndex > characterIndex) break;
      cueIndex = index;
    }
    if (speech.cueIndex !== cueIndex) {
      speech.cueIndex = cueIndex;
      speech.cueChangedAt = now;
    }
    const frame = speech.mouthCues[cueIndex].frame;
    const phase = Math.min(6, Math.floor((now - speech.cueChangedAt) / 21));
    return ['speechFluid', frame * 7 + phase];
  }

  function finishSpeech(speech) {
    if (state.speech !== speech) return;
    if (speech.audioUrl) URL.revokeObjectURL(speech.audioUrl);
    state.speech = null;
    if (!state.gesture && !state.destination) setStatus('Ready to guide');
  }

  function cancelSpeech() {
    if (state.pendingSpeech) {
      state.pendingSpeech.abort();
      state.pendingSpeech = null;
    }
    const speech = state.speech;
    state.speech = null;
    if (speech?.audio) {
      speech.audio.pause();
      speech.audio.src = '';
      if (speech.audioUrl) URL.revokeObjectURL(speech.audioUrl);
    }
    if (speech && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  function createSpeechState(message, alignment = null, audio = null, audioUrl = null) {
    const now = performance.now();
    const mouthCues = [{ characterIndex: 0, frame: 6 }];
    const cuePattern = /[aeiouy]+|[mbp]+|[.!?]+/gi;
    for (const match of message.matchAll(cuePattern)) {
      const frame = /[.!?]/.test(match[0]) ? 6 : vowelFrame(match[0][0]);
      if (mouthCues[mouthCues.length - 1].frame !== frame) {
        mouthCues.push({ characterIndex: match.index, frame });
      }
    }
    return {
      text: message, started: now, estimatedDuration: Math.max(2000, message.length * 95),
      boundaryIndex: 0, boundaryAt: now, hasBoundary: false,
      mouthCues, cueIndex: -1, cueChangedAt: now, alignment, audio, audioUrl
    };
  }

  function speakWithBrowser(message) {
    const speech = createSpeechState(message);
    state.speech = speech;
    setStatus('Speaking');
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(message);
      if (!selectedVoice) loadVoices();
      window.DorkVoice.apply(utterance, selectedVoice);
      utterance.onstart = () => { speech.started = performance.now(); speech.boundaryAt = speech.started; };
      utterance.onboundary = (event) => {
        speech.boundaryIndex = event.charIndex;
        speech.boundaryAt = performance.now();
        speech.hasBoundary = true;
      };
      utterance.onend = () => finishSpeech(speech);
      utterance.onerror = () => finishSpeech(speech);
      window.speechSynthesis.speak(utterance);
    } else {
      window.setTimeout(() => finishSpeech(speech), speech.estimatedDuration);
    }
  }

  async function speakWithNaturalVoice(message, voiceId) {
    const requestController = new AbortController();
    state.pendingSpeech = requestController;
    setStatus('Thinking…');
    try {
      const response = await fetch(voiceId ? '/api/speech' : '/api/embed/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(voiceId ? { text: message, voiceId } : { text: message }),
        signal: requestController.signal,
        cache: 'no-store'
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Natural voice could not generate speech.');
      if (state.pendingSpeech !== requestController) return;
      state.pendingSpeech = null;
      const encoded = atob(result.audioBase64);
      const audioBytes = Uint8Array.from(encoded, (character) => character.charCodeAt(0));
      const audioMimeType = result.audioMimeType === 'audio/wav' ? 'audio/wav' : 'audio/mpeg';
      const audioUrl = URL.createObjectURL(new Blob([audioBytes], { type: audioMimeType }));
      const audio = new Audio(audioUrl);
      const speech = createSpeechState(message, result.alignment, audio, audioUrl);
      state.speech = speech;
      audio.onplay = () => {
        if (state.speech !== speech) return;
        speech.started = performance.now();
        if (Number.isFinite(audio.duration) && audio.duration > 0) speech.estimatedDuration = audio.duration * 1000;
        setStatus('Speaking');
      };
      audio.onended = () => finishSpeech(speech);
      audio.onerror = () => {
        finishSpeech(speech);
        setStatus('Audio playback failed');
      };
      await audio.play();
    } catch (error) {
      if (requestController.signal.aborted) return;
      cancelSpeech();
      voiceNotice.textContent = `${error.message || 'Natural voice failed.'} Using a browser voice.`;
      speakWithBrowser(message);
    }
  }

  function speak(text, keepMovement = false) {
    const message = String(text || '').trim();
    if (!message) return;
    cancelSpeech();
    if (!keepMovement) {
      state.destination = null;
      state.onArrival = null;
      state.gesture = null;
    }
    speakWithBrowser(message);
  }

  function gestureFrame(gesture, now) {
    const elapsed = Math.max(0, now - gesture.started);
    if (elapsed >= gesture.duration) {
      state.gesture = null;
      setStatus(state.speech ? 'Speaking' : 'Ready to guide');
      return null;
    }
    if (gesture.type === 'point' || gesture.type === 'wave' || gesture.type === 'joy') {
      const sheet = `${gesture.type}Fluid`;
      const count = fluidFrameCounts[sheet];
      const progress = Math.min(1, elapsed / gesture.duration);
      const eased = (1 - Math.cos(progress * Math.PI)) / 2;
      return [sheet, Math.min(count - 1, Math.floor(eased * count))];
    }
    if (gesture.type === 'dance') {
      const phase = Math.floor(elapsed / 2000 * fluidFrameCounts.danceFluid);
      return ['danceFluid', phase % fluidFrameCounts.danceFluid,
        Math.floor(elapsed / 2000) % 2 === 1];
    }
    return null;
  }

  function animate(now) {
    const delta = Math.min(0.05, (now - (state.lastTick || now)) / 1000);
    state.lastTick = now;

    if (state.destination) {
      const dx = state.destination.x - state.x;
      const dy = state.destination.y - state.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= 4) {
        state.x = state.destination.x;
        state.y = state.destination.y;
        state.destination = null;
        const callback = state.onArrival;
        state.onArrival = null;
        setStatus('Ready to guide');
        if (callback) callback();
      } else {
        const brakingSpeed = Math.min(WALK_SPEED, Math.sqrt(400 * distance));
        const acceleration = Math.min(1, Math.max(0.05, (now - state.walkStarted) / 320));
        const step = Math.min(distance, brakingSpeed * acceleration * delta);
        state.x += dx / distance * step;
        state.y += dy / distance * step;
      }
    }
    placeActor(now);
    updateGuidePointer();

    if (state.ready) {
      if (state.destination) {
        const halfCycle = fluidFrameCounts.walkFluid;
        const frameMs = WALK_HALF_DURATION_MS / halfCycle;
        const step = Math.floor(Math.max(0, now - state.walkStarted) / frameMs) % (halfCycle * 2);
        drawFrame('walkFluid', step % halfCycle, now, step >= halfCycle);
      } else if (state.gesture) {
        const gesture = gestureFrame(state.gesture, now);
        if (gesture) drawFrame(gesture[0], gesture[1], now, Boolean(gesture[2]));
        else {
          const pose = speechPose(now);
          drawFrame(pose[0], pose[1], now);
        }
      } else if (state.speech) {
        const pose = speechPose(now);
        drawFrame(pose[0], pose[1], now);
      } else {
        if (now >= state.nextBlink) {
          state.blinkUntil = now + 130;
          state.nextBlink = now + 3000 + Math.random() * 2800;
        }
        drawFrame('speechFluid', now < state.blinkUntil ? 55 : 0, now);
      }
    }

    if (state.guide?.awaiting && !state.destination && !state.gesture) startGesture('point', true);
    if (window.Nova3D?.ready) {
      const gaze = state.pointer.active ? {
        x: Math.max(-1, Math.min(1, (state.pointer.x - state.x - actor.offsetWidth * 0.5) / Math.max(300, window.innerWidth * 0.36))),
        y: Math.max(-1, Math.min(1, (state.pointer.y - state.y - actor.offsetHeight * 0.28) / Math.max(240, window.innerHeight * 0.42)))
      } : null;
      window.Nova3D.sync({
        walking: Boolean(state.destination),
        walkStarted: state.walkStarted,
        direction: state.destination ? state.destination.x - state.x : 0,
        gesture: state.gesture,
        speechFrame: state.speech ? speechPose(now)[1] : null,
        blink: now < state.blinkUntil,
        gaze
      }, now);
    }
    requestAnimationFrame(animate);
  }

  document.querySelectorAll('[data-walkthrough-target]').forEach((button) => {
    button.addEventListener('click', () => {
      cancelChatRequest();
      if (completeGuideStep(button)) return;
      const action = button.dataset.walkthroughTarget;
      const responses = {
        features: { text: 'Let us try the vowel sounds together: ah, eh, ee, oh, oo. My mouth follows the text as I speak.', gesture: 'point' },
        pricing: { text: 'These Starter, Growth, and Enterprise plans are examples for the prototype. There are no live prices yet.', gesture: 'point' },
        contact: { text: 'Thanks for exploring with me! You can send a suggestion or bug report using the form below.', gesture: 'joy' }
      };
      const response = responses[action];
      if (!response) return;
      addChatBubble('assistant', response.text);
      startGesture(response.gesture, true);
      speak(response.text, true);
      if (action === 'contact') document.querySelector('#contactForm [name="message"]')?.focus({ preventScroll: true });
    });
  });
  document.querySelectorAll('[data-workflow-step]').forEach((button) => {
    button.addEventListener('click', () => setWorkflowStep(button.dataset.workflowStep));
  });
  document.querySelectorAll('[data-integration-filter]').forEach((button) => {
    button.addEventListener('click', () => setIntegrationFilter(button.dataset.integrationFilter));
  });
  document.getElementById('speechForm').addEventListener('submit', (event) => {
    event.preventDefault();
    askAI();
  });
  document.querySelectorAll('[data-welcome-prompt]').forEach((button) => {
    button.addEventListener('click', () => {
      speechInput.value = button.dataset.welcomePrompt;
      askAI();
    });
  });
  document.querySelectorAll('[data-avatar-gesture]').forEach((button) => {
    button.addEventListener('click', () => {
      cancelChatRequest();
      const type = button.dataset.avatarGesture;
      const reply = gestureResponses[type];
      if (!reply) return;
      if (state.guide) endGuide(false);
      startGesture(type, true);
      addChatBubble('assistant', reply);
      speak(reply, true);
    });
  });
  window.addEventListener('nova:scene-request', (event) => {
    const element = event.detail?.element;
    if (!element?.matches?.('.cinematic-scene')) return;
    revealSite();
    showLandmark(element);
  });
  document.getElementById('retryModels').addEventListener('click', loadAIProviders);
  aiProvider.addEventListener('change', () => {
    providerChoiceTouched = true;
    updateProviderNotice();
    if (aiProvider.value === 'device') {
      window.DorkLocalAI.prepare(mainAiContext(), (percent) => { modelNotice.textContent = `Downloading on-device model… ${percent}%`; })
        .then(() => { modelNotice.textContent = 'On-device AI ready.'; })
        .catch((error) => { modelNotice.classList.add('error'); modelNotice.textContent = error.message; });
      if (!voiceChoiceTouched) voiceSelect.value = [...voiceSelect.options].find((option) => option.value.startsWith('browser:'))?.value || 'browser:default';
    }
  });
  modelSelect.addEventListener('change', updateProviderNotice);
  document.getElementById('avatarHit').addEventListener('click', () => {
    if (!state.guide) {
      speak(state.intro
        ? 'Welcome to Aura! I am Dork, your guide. Ask me to show you the site, or tell me what you are curious about.'
        : 'Hi! Type “show me the site” in chat and I will guide you.');
      startGesture('wave', true);
    }
  });
  voiceSelect.addEventListener('change', () => {
    voiceChoiceTouched = true;
    const browserIndex = Number(voiceSelect.value.split(':')[1]);
    selectedVoice = voiceSelect.value.startsWith('browser:') ? availableVoices[browserIndex] || null : null;
  });
  document.getElementById('skipGuide').addEventListener('click', () => endGuide());
  skipGuideInline.addEventListener('click', () => endGuide());
  window.addEventListener('resize', () => {
    Object.assign(state, state.intro ? introPosition() : state.guide ? clampPosition(state.x, state.y) : dockPosition());
    if (state.destination) state.destination = clampPosition(state.destination.x, state.destination.y);
    placeActor();
  });

  const initial = introPosition();
  state.x = initial.x;
  state.y = initial.y;
  state.nextBlink = performance.now() + 2400;
  addChatBubble('assistant', 'Welcome to Aura! I’m Dork. I can answer questions or take you on a guided tour. What would you like to explore?');
  placeActor();
  requestAnimationFrame(animate);
  renderVoiceOptions();
  loadVoices();
  loadAIProviders();
  window.addEventListener('nova3dready', () => {
    state.ready = true;
    if (!state.guide && !state.destination) {
      Object.assign(state, state.intro ? introPosition() : dockPosition());
      placeActor();
    }
    setStatus('Ready to guide');
    if (state.intro) startGesture('wave', true);
  });
  if ('speechSynthesis' in window) window.speechSynthesis.addEventListener('voiceschanged', loadVoices);

  function loadSpriteFallback() {
    if (window.Nova3D?.ready) return;
    state.ready = true;
    setStatus('Ready to guide');
  }
  window.addEventListener('nova3dfailed', loadSpriteFallback, { once: true });
  window.setTimeout(loadSpriteFallback, 1500);
})();
