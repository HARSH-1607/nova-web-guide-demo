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
  const caption = document.getElementById('dorkCaption');
  const listenButton = document.getElementById('listenButton');
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
  let actorClickCount = 0;
  let voiceEnabled = false;
  let recognition = null;
  let listening = false;
  let voiceBlocked = false;
  let voiceRestartTimer = 0;
  let referencedTarget = null;
  let referencedAt = 0;
  let lastCommandPhrase = '';
  let lastTargetKey = null;
  const phraseStoreKey = 'dork-site-phrases-v1';
  let rememberedPhrases = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(phraseStoreKey) || '[]');
    if (Array.isArray(saved)) rememberedPhrases = new Map(saved.slice(-40).filter((entry) =>
      Array.isArray(entry) && typeof entry[0] === 'string' && entry[1] && typeof entry[1] === 'object'));
  } catch { /* Private browsing can disable storage. */ }
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
    resumeListeningSoon();
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
    rememberTarget(event.target);
  }, { passive: true });
  document.addEventListener('focusin', (event) => rememberTarget(event.target));
  document.addEventListener('pointerdown', (event) => rememberTarget(event.target), { passive: true });
  window.addEventListener('blur', () => { state.pointer.active = false; });
  document.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) state.pointer.active = false;
  });
  function rememberTarget(node) {
    const target = node?.closest?.('[data-guide-spot], [data-walkthrough-target]');
    if (target && !target.closest('[hidden]')) {
      referencedTarget = target;
      referencedAt = performance.now();
    }
  }
  function referenceTarget() {
    if (referencedTarget?.isConnected && performance.now() - referencedAt < 30000) return referencedTarget;
    const focused = document.activeElement?.closest?.('[data-guide-spot], [data-walkthrough-target]');
    if (focused) return focused;
    return [...document.querySelectorAll('.cinematic-scene')].find((section) => {
      const rect = section.getBoundingClientRect();
      return rect.top < innerHeight * 0.55 && rect.bottom > innerHeight * 0.55;
    }) || document.querySelector('[data-guide-spot="home"]');
  }
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

  function showDorkResponse(message) {
    caption.textContent = message;
    caption.title = message;
    caption.hidden = false;
    caption.classList.remove('caption-arrive');
    void caption.offsetWidth;
    caption.classList.add('caption-arrive');
    window.clearTimeout(showDorkResponse.timer);
    showDorkResponse.timer = window.setTimeout(() => {
      if (!state.speech) caption.hidden = true;
    }, Math.min(14000, Math.max(5500, message.length * 95)));
  }

  const guideSteps = {
    features: { target: 'features', text: 'Let me show you speech motion. Click the glowing “Hear the vowels” button.', done: 'Ah. Eh. Ee. Oh. Oo. Those sounds drive my approximate mouth motion.' },
    pricing: { target: 'pricing', text: 'Here is the pricing section. Click “Ask about plans” to learn what is available in this prototype.', done: 'These plans are placeholders. There are no live prices yet.' },
    contact: { target: 'contact', text: 'Here is the last stop. Click “Finish the tour” to complete the walkthrough.', done: 'That is the tour! Ask me a question any time.' }
  };

  function classifyGuideRequest(message) {
    if (/\b(tour|walk.?through|show me (the |this )?(site|website|around)|how (do i|to) use (this|the) (site|website))\b/i.test(message)) return 'tour';
    if (!/\b(show|take|go|bring|move|navigate|find|where|visit|head|point|open|walk)\b/i.test(message)
      && !/^(pricing|prices|plans|features|contact)[.!?]?$/i.test(message.trim())) return null;
    if (/\b(pric(?:e|es|ing)|cost|plans?)\b/i.test(message)) return 'pricing';
    if (/\b(feature|speech|lip.?sync|vowel)\b/i.test(message)) return 'features';
    if (/\b(contact|finish|last stop)\b/i.test(message)) return 'contact';
    return null;
  }

  const gestureResponses = {
    wave: 'Hello! Here is a wave.', nod: 'Yes, I am listening.',
    shake: 'Not quite. Let us try another way.', think: 'Hmm. Let me think about that.',
    fistBump: 'Fist bump! We make a good team.', jump: 'Here we go!',
    dance: 'Let me show you my dance.', joy: 'Let us celebrate!',
    curious: 'Now you have my attention.', bow: 'At your service.',
    spin: 'Watch this little turn.', peek: 'I see what you are looking at.'
  };

  function classifyActionRequest(message) {
    const patterns = [
      ['wave', /\b(wave|say hi)\b|^hello(?: dork)?[!. ]*$/i], ['dance', /\b(dance|dancing)\b/i],
      ['joy', /\b(celebrate|joy|happy)\b/i], ['nod', /\b(nod|agree with me)\b/i],
      ['shake', /\b(shake your head|say no|disagree)\b/i],
      ['fistBump', /\b(fist.?bump|high.?five)\b/i], ['jump', /\b(jump|hop)\b/i],
      ['think', /\b(think pose|look thoughtful|thinking animation)\b/i],
      ['curious', /\b(be curious|look curious|curious pose)\b/i],
      ['bow', /\b(bow|take a bow)\b/i], ['spin', /\b(spin|turn around|twirl)\b/i],
      ['peek', /\b(peek|look over there)\b/i]
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

  function taskTargets() {
    const targets = [...document.querySelectorAll('[data-guide-spot]')].map((element) => ({
      key: `spot:${element.dataset.guideSpot}`, mode: 'place', element,
      label: element.querySelector('h1,h2,h3')?.textContent?.trim() || element.dataset.guideSpot,
      description: element.dataset.guideDescription || ''
    }));
    document.querySelectorAll('[data-workflow-step]').forEach((element) => targets.push({
      key: `control:workflow:${element.dataset.workflowStep}`, mode: 'control', element,
      label: `${element.dataset.workflowStep} workflow step`, description: element.textContent.trim()
    }));
    document.querySelectorAll('[data-integration-filter]').forEach((element) => targets.push({
      key: `control:filter:${element.dataset.integrationFilter}`, mode: 'control', element,
      label: `${element.dataset.integrationFilter} integration filter`, description: 'Filter the example integrations.'
    }));
    document.querySelectorAll('.faq-list summary').forEach((element, index) => targets.push({
      key: `control:faq:${index}`, mode: 'control', element,
      label: element.textContent.trim(), description: 'Open this FAQ answer.'
    }));
    document.querySelectorAll('[data-walkthrough-target]').forEach((element) => targets.push({
      key: `control:try:${element.dataset.walkthroughTarget}`, mode: 'control', element,
      label: element.textContent.trim(), description: `Try the ${element.dataset.walkthroughTarget} demonstration.`
    }));
    const feedback = document.querySelector('#contactForm [name="message"]');
    if (feedback) targets.push({ key: 'control:feedback', mode: 'control', element: feedback,
      label: 'feedback message field', description: 'Focus the suggestion or bug report form.' });
    return targets;
  }

  function normalizePhrase(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function rememberPhrase(phrase, task) {
    const normalized = normalizePhrase(phrase);
    if (normalized.length < 3 || normalized.length > 100 || /@|\b\d{4,}\b/.test(phrase)
      || !['navigate', 'activate', 'gesture', 'tour'].includes(task.action)) return;
    rememberedPhrases.delete(normalized);
    rememberedPhrases.set(normalized, { action: task.action, target: task.target || null, gesture: task.gesture || null });
    while (rememberedPhrases.size > 40) rememberedPhrases.delete(rememberedPhrases.keys().next().value);
    try { localStorage.setItem(phraseStoreKey, JSON.stringify([...rememberedPhrases])); } catch { /* Storage is optional. */ }
  }

  function resolveNamedTarget(phrase) {
    const normalized = normalizePhrase(phrase);
    const candidates = taskTargets();
    let best = null;
    let score = 0;
    for (const target of candidates) {
      const aliases = target.mode === 'place'
        ? [target.element.dataset.guideSpot, ...(target.element.dataset.guideAliases || '').split(','), target.label]
        : [target.label];
      for (const alias of aliases) {
        const term = normalizePhrase(alias);
        if (!term) continue;
        const match = normalized === term ? 1000 + term.length
          : (` ${normalized} `).includes(` ${term} `) ? term.length : 0;
        if (match > score) { best = target; score = match; }
      }
    }
    return best;
  }

  function findLandmark(message) {
    const normalized = message.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!/\b(go|take|navigate|move|show|find|where|bring|visit|head|point|open)\b/.test(normalized)
      && !/^(logo|faq|workflow|integrations|trust|home)$/.test(normalized)) return null;
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
    return clampPosition(window.innerWidth - size.width - 18,
      window.innerHeight - size.height - (window.innerWidth < 700 ? 64 : 72));
  }

  function introPosition() {
    const size = actorSize();
    return {
      x: Math.max(0, (window.innerWidth - size.width) / 2),
      y: Math.max(window.innerWidth <= 600 ? 150 : 120,
        Math.min((window.innerHeight - size.height) * 0.54, window.innerHeight - size.height - 120))
    };
  }

  function guidedPosition(target) {
    const rect = target.getBoundingClientRect();
    const size = actorSize();
    if (window.innerWidth < 700) {
      return { x: window.innerWidth - size.width - 12,
        y: Math.max(8, Math.min(rect.top - size.height * 0.4, window.innerHeight - size.height - 70)) };
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
    cancelSpeech();
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

  function showLandmark(element, descriptionOverride = '') {
    cancelChatRequest();
    endGuide(false);
    window.dispatchEvent(new CustomEvent('nova:guide-target', { detail: { element } }));
    if (element.matches('[data-integration-category]')) setIntegrationFilter(element.dataset.integrationCategory);
    const focus = element.querySelector('h1,h2,h3') || element;
    const guide = { cancelled: false, awaiting: false, targetElement: focus, landmark: true };
    state.guide = guide;
    skipGuideInline.hidden = false;
    const description = descriptionOverride || element.dataset.guideDescription || (element.dataset.walkthroughTarget
      ? `This is the ${element.textContent.trim()} button. You can click it to try this part of the site.`
      : `Here is ${element.getAttribute('aria-label') || element.textContent.trim() || element.dataset.guideSpot}.`);
    showDorkResponse(description);
    transitionToTarget(element, focus, () => {
      if (state.guide !== guide || guide.cancelled) return;
      guide.awaiting = true;
      focus.classList.add('guide-target-active');
      guidePointer.hidden = false;
      guideHintText.textContent = description;
      guideHint.hidden = false;
      positionGuideHint();
      const narration = speak(description, true);
      startGesture('point', true);
      narration.then((completed) => {
        if (completed && state.guide === guide) window.setTimeout(() => {
          if (state.guide === guide) endGuide();
        }, 900);
      });
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
    showDorkResponse(instruction);
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
    const priorLine = state.speech?.completion || Promise.resolve(true);
    priorLine.then((heard) => {
      if (!heard || state.guide !== guide || guide.cancelled) return;
      showDorkResponse(step.done);
      if (step.target === 'contact') startGesture('joy', true);
      speak(step.done, true).then((completed) => {
        if (!completed || state.guide !== guide || guide.cancelled) return;
        guide.index += 1;
        if (guide.index < guide.steps.length) showGuideStep();
        else if (guide.tour) {
          endGuide();
          document.body.classList.add('journey-complete');
          window.dispatchEvent(new Event('nova:tour-complete'));
          const finished = 'The tour is complete. Keep exploring any part of the website!';
          showDorkResponse(finished);
          speak(finished, true);
        } else endGuide();
      });
    });
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

  function performTask(task, originalPhrase = '', learn = false) {
    const target = taskTargets().find((item) => item.key === task.target);
    const gesture = gestureResponses[task.gesture];
    if (task.action === 'tour') {
      revealSite();
      beginGuide('tour');
    } else if (task.action === 'gesture' && gesture) {
      endGuide(false);
      showDorkResponse(gesture);
      startGesture(task.gesture, true);
      speak(gesture, true);
    } else if (task.action === 'navigate' && target) {
      revealSite();
      lastTargetKey = target.key;
      showLandmark(target.element, target.description || `Here is ${target.label}.`);
    } else if (task.action === 'activate' && target?.mode === 'control') {
      revealSite();
      endGuide(false);
      lastTargetKey = target.key;
      transitionToTarget(target.element, target.element, () => {
        target.element.classList.add('guide-target-active');
        window.setTimeout(() => target.element.classList.remove('guide-target-active'), 1800);
        if (target.key === 'control:feedback') target.element.focus({ preventScroll: true });
        else target.element.click();
        if (target.key.startsWith('control:try:')) return;
        const reply = `I opened ${target.label}.`;
        showDorkResponse(reply);
        startGesture('point', true);
        speak(reply, true);
      });
    } else if (['answer', 'clarify'].includes(task.action)) {
      const reply = task.reply || 'Tell me which part of the site you mean.';
      showDorkResponse(reply);
      speak(reply, true);
    } else return false;
    if (learn) rememberPhrase(originalPhrase, task);
    return true;
  }

  function teachPhrase(message) {
    if (/^(?:forget|clear|erase) (?:my |the )?(?:phrases|shortcuts|commands|memory)\b/i.test(message)) {
      rememberedPhrases.clear();
      try { localStorage.removeItem(phraseStoreKey); } catch { /* Storage is optional. */ }
      const reply = 'I cleared the phrases you taught me on this browser.';
      showDorkResponse(reply);
      speak(reply, true);
      return true;
    }
    const teaching = message.match(/^(?:remember(?: that)?\s+)?when i say\s+["“']?(.+?)["”']?\s*,?\s*(?:i mean|it means|take me to|show me|go to)\s+(.+?)[.!]?$/i);
    const correction = message.match(/^(?:no|not that)[,;.! ]+(?:i meant|i mean|take me to|show me)\s+(.+?)[.!]?$/i);
    if (!teaching && !correction) return false;
    const target = resolveNamedTarget(teaching ? teaching[2] : correction[1]);
    if (!target) {
      const reply = 'I could not match that place on this page. Try naming a section or button.';
      showDorkResponse(reply);
      speak(reply, true);
      return true;
    }
    const phrase = teaching ? teaching[1] : lastCommandPhrase;
    if (phrase) rememberPhrase(phrase, { action: 'navigate', target: target.key });
    lastTargetKey = target.key;
    const reply = phrase ? `Got it. When you say “${phrase}”, I will go to ${target.label}.` : `Got it. I will go to ${target.label}.`;
    showDorkResponse(reply);
    speak(reply, true);
    return true;
  }

  async function askAI(rawMessage) {
    const message = String(rawMessage || '').trim();
    if (!message) {
      if (chatRequestInFlight) {
        cancelChatRequest();
        state.gesture = null;
        setStatus('Ready to guide');
        showDorkResponse('Stopped. What would you like to explore next?');
      }
      return;
    }
    if (chatRequestInFlight) cancelChatRequest();
    if (/^(stop|cancel|skip)(?: (?:the )?(?:tour|walkthrough))?[.!]?$/i.test(message)) {
      endGuide();
      showDorkResponse('Okay, I stopped the walkthrough. Ask me when you want to start again.');
      speak('Okay, I stopped the walkthrough.', true);
      return;
    }
    if (teachPhrase(message)) return;
    const remembered = rememberedPhrases.get(normalizePhrase(message));
    lastCommandPhrase = message;
    if (remembered && performTask(remembered)) return;
    if (/\b(enter|open|explore|browse)\b.*\b(site|website|page)\b/i.test(message)) {
      revealSite();
      const reply = 'Welcome in! Ask me to show any section, or say “show me around” for a tour.';
      showDorkResponse(reply);
      speak(reply, true);
      return;
    }
    if (state.intro && /\b(what can you do|how can you help|what do you do)\b/i.test(message)) {
      const reply = 'I can guide you to features, pricing, and contact, point out buttons, and give you a tour. Point at something and say “show me that.” You can also ask me to wave, dance, or bow.';
      showDorkResponse(reply);
      speak(reply, true);
      startGesture('point', true);
      return;
    }
    const specificLandmark = findLandmark(message);
    if (specificLandmark && !specificLandmark.matches('.cinematic-scene, .brand')) {
      revealSite();
      showLandmark(specificLandmark);
      return;
    }
    const guideRequest = classifyGuideRequest(message);
    if (guideRequest) {
      revealSite();
      beginGuide(guideRequest);
      return;
    }
    if (/\b(show|take|go|explain|tell|what)\b.*\b(that|this|there|here)\b/i.test(message)) {
      const target = referenceTarget();
      if (target) {
        revealSite();
        showLandmark(target);
      }
      return;
    }
    const actionRequest = classifyActionRequest(message);
    if (actionRequest) {
      const wasGuiding = Boolean(state.guide);
      endGuide(wasGuiding);
      showDorkResponse(actionRequest.reply);
      speak(actionRequest.reply, wasGuiding);
      if (wasGuiding) state.onArrival = () => startGesture(actionRequest.gesture, true);
      else startGesture(actionRequest.gesture, true);
      return;
    }
    const landmark = findLandmark(message);
    if (landmark) {
      revealSite();
      showLandmark(landmark);
      return;
    }
    const wasGuiding = Boolean(state.guide);
    endGuide(wasGuiding);
    const provider = aiProvider.value;
    const useOnline = provider === 'online';
    if (providersChecked && !(provider === 'device' ? onDeviceAvailable : useOnline ? onlineAvailable : localAvailable)) {
      const help = 'AI answers are unavailable right now. You can still ask me to show a section or take a tour.';
      showDorkResponse(help);
      modelNotice.classList.add('error');
      updateProviderNotice();
      setStatus('Ready to guide');
      startGesture('point', true);
      return;
    }
    chatRequestInFlight = true;
    const requestController = new AbortController();
    chatRequestController = requestController;
    startGesture('think', true);
    setStatus('Thinking…');
    modelNotice.classList.remove('error');
    modelNotice.textContent = provider === 'device' ? 'Dork is thinking on this device…' : useOnline ? 'Dork is thinking online…' : 'Dork is thinking on your local model…';
    try {
      let result;
      if (useOnline) {
        const targets = taskTargets().map(({ key, mode, label, description }) => ({ key, mode, label, description }));
        const response = await fetch('/api/online/plan', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, history: conversation.slice(-8), targets, recentTarget: lastTargetKey }),
          signal: requestController.signal, cache: 'no-store'
        });
        const plan = await response.json();
        if (!response.ok) throw new Error(plan.error || 'Dork could not understand that request.');
        if (chatRequestController !== requestController) return;
        conversation.push({ role: 'user', content: message }, { role: 'assistant', content: plan.reply });
        conversation = conversation.slice(-8);
        state.gesture = null;
        if (!performTask(plan, message, true)) throw new Error('Dork could not match that action to this page.');
        return;
      } else if (provider === 'device') {
        const reply = await window.DorkLocalAI.answer(message, mainAiContext(), requestController.signal,
          (percent) => { if (chatRequestController === requestController) modelNotice.textContent = `Downloading on-device model… ${percent}%`; });
        result = { reply, model: 'On-device AI' };
      } else {
        const response = await fetch('/api/llm/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, model: modelSelect.value, history: conversation.slice(-8) }),
          signal: requestController.signal, cache: 'no-store'
        });
        result = await response.json();
        if (!response.ok) throw new Error(result.error || 'The AI could not answer.');
      }
      if (chatRequestController !== requestController) return;
      showDorkResponse(result.reply);
      conversation.push({ role: 'user', content: message }, { role: 'assistant', content: result.reply });
      conversation = conversation.slice(-8);
      modelNotice.textContent = `Answered by ${result.model} · voice: ${voiceSelect.selectedOptions[0]?.textContent || 'browser'}`;
      state.gesture = null;
      speak(result.reply, wasGuiding);
    } catch (error) {
      if (requestController.signal.aborted || chatRequestController !== requestController) return;
      state.gesture = null;
      const detail = error.message || 'Could not contact the AI.';
      showDorkResponse(`I could not answer: ${detail}`);
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
    return {
      x: Math.max(0, Math.min(window.innerWidth - width, x)),
      y: Math.max(0, Math.min(window.innerHeight - height, y))
    };
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
      nod: 1900, shake: 1900, think: 2300, fistBump: 1700, jump: 2000,
      curious: 2600, bow: 2600, spin: 2900, peek: 2500 }[type];
    if (!duration) return;
    if (!keepSpeech) cancelSpeech();
    state.destination = null;
    state.onArrival = null;
    state.gesture = { type, started: performance.now(), duration };
    setStatus({ point: 'Pointing', wave: 'Waving', dance: 'Dancing', joy: 'Feeling joyful',
      nod: 'Nodding', shake: 'Shaking my head', think: 'Thinking', fistBump: 'Fist bump', jump: 'Jumping',
      curious: 'Curious', bow: 'Bowing', spin: 'Spinning', peek: 'Peeking' }[type]);
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
    window.clearTimeout(speech.watchdog);
    if (speech.audioUrl) URL.revokeObjectURL(speech.audioUrl);
    state.speech = null;
    speech.resolve?.(true);
    if (!state.gesture && !state.destination) setStatus('Ready to guide');
    window.clearTimeout(showDorkResponse.timer);
    showDorkResponse.timer = window.setTimeout(() => { caption.hidden = true; }, 2500);
    resumeListeningSoon();
  }

  function cancelSpeech() {
    if (state.pendingSpeech) {
      state.pendingSpeech.abort();
      state.pendingSpeech = null;
    }
    const speech = state.speech;
    state.speech = null;
    if (speech) {
      window.clearTimeout(speech.watchdog);
      speech.resolve?.(false);
    }
    if (speech?.audio) {
      speech.audio.pause();
      speech.audio.src = '';
      if (speech.audioUrl) URL.revokeObjectURL(speech.audioUrl);
    }
    if (speech && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  function updateVoiceButton() {
    listenButton.setAttribute('aria-pressed', String(voiceEnabled));
    listenButton.setAttribute('aria-label', voiceEnabled ? 'Turn off voice commands' : 'Turn on voice commands');
    listenButton.title = voiceEnabled ? 'Turn off voice commands' : 'Turn on voice commands';
    listenButton.classList.toggle('voice-on', voiceEnabled);
    listenButton.classList.toggle('is-listening', listening);
  }

  function pauseListening() {
    window.clearTimeout(voiceRestartTimer);
    if (listening && recognition) {
      listening = false;
      try { recognition.stop(); } catch { /* Recognition may already be ending. */ }
      updateVoiceButton();
    }
  }

  function resumeListeningSoon(delay = 350) {
    if (!voiceEnabled || !recognition) return;
    window.clearTimeout(voiceRestartTimer);
    const startRecognition = () => {
      if (!voiceEnabled || listening || state.speech || state.pendingSpeech || chatRequestInFlight) return;
      try {
        recognition.start();
        listening = true;
        setStatus('Listening…');
        updateVoiceButton();
      } catch { resumeListeningSoon(1000); }
    };
    if (delay <= 0) startRecognition();
    else voiceRestartTimer = window.setTimeout(startRecognition, delay);
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
    pauseListening();
    const speech = createSpeechState(message);
    speech.completion = new Promise((resolve) => { speech.resolve = resolve; });
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
      speech.watchdog = window.setTimeout(() => finishSpeech(speech),
        Math.min(45000, Math.max(10000, message.length * 180)));
    } else {
      speech.watchdog = window.setTimeout(() => finishSpeech(speech), speech.estimatedDuration);
    }
    return speech.completion;
  }

  async function speakWithNaturalVoice(message, voiceId) {
    pauseListening();
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
    if (!message) return Promise.resolve(true);
    cancelSpeech();
    if (!keepMovement) {
      state.destination = null;
      state.onArrival = null;
      state.gesture = null;
    }
    return speakWithBrowser(message);
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
      showDorkResponse(response.text);
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
  document.querySelectorAll('[data-welcome-prompt]').forEach((button) => {
    button.addEventListener('click', () => askAI(button.dataset.welcomePrompt));
  });
  document.querySelectorAll('[data-guide-command]').forEach((button) => {
    button.addEventListener('click', () => askAI(button.dataset.guideCommand));
  });
  window.DorkGuide = Object.freeze({
    ask: (message) => askAI(message),
    open: () => revealSite(),
    startTour: () => { revealSite(); beginGuide('tour'); }
  });
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = (navigator.languages || [navigator.language]).find((language) => /^en(?:-|$)/i.test(language)) || 'en-GB';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    listenButton.addEventListener('click', () => {
      voiceEnabled = !voiceEnabled;
      updateVoiceButton();
      if (voiceEnabled) resumeListeningSoon(0);
      else { pauseListening(); setStatus('Voice commands off'); }
    });
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      listening = false;
      try { recognition.stop(); } catch { /* Recognition may already be ending. */ }
      updateVoiceButton();
      setStatus(`Heard: ${transcript}`);
      askAI(transcript);
    };
    recognition.onerror = (event) => {
      listening = false;
      if (['not-allowed', 'service-not-allowed'].includes(event.error)) {
        voiceEnabled = false;
        voiceBlocked = true;
        showDorkResponse('Microphone access is blocked. Allow microphone access in your browser, then try again.');
        setStatus('Microphone access denied');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setStatus('Voice input interrupted');
      }
      updateVoiceButton();
    };
    recognition.onend = () => {
      listening = false;
      updateVoiceButton();
      resumeListeningSoon(550);
    };
  } else {
    listenButton.disabled = true;
    listenButton.title = 'Voice commands require a browser with speech recognition';
    listenButton.setAttribute('aria-label', listenButton.title);
    document.querySelector('.welcome-copy p').textContent = 'Voice commands are unavailable in this browser. Tap Dork to open the website.';
  }
  document.querySelectorAll('[data-avatar-gesture]').forEach((button) => {
    button.addEventListener('click', () => {
      cancelChatRequest();
      const type = button.dataset.avatarGesture;
      const reply = gestureResponses[type];
      if (!reply) return;
      if (state.guide) endGuide(false);
      startGesture(type, true);
      showDorkResponse(reply);
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
    if (state.guide) return;
    if (state.intro && (!recognition || voiceBlocked)) revealSite();
    const reactions = ['wave', 'nod', 'joy', 'dance', 'curious', 'bow', 'spin', 'peek'];
    const gesture = reactions[actorClickCount++ % reactions.length];
    const line = state.intro && actorClickCount === 1
      ? 'Welcome to Aura! Switch on the microphone and say “show me the site.”'
      : gestureResponses[gesture];
    showDorkResponse(line);
    speak(line, true);
    startGesture(gesture, true);
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
  showDorkResponse('Welcome to Aura! I’m Dork. Tap the microphone and say “show me the site.”');
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
