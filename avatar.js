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
  const guideHintText = document.getElementById('guideHintText');
  const guidePointer = document.getElementById('guidePointer');
  const guidePointerLine = document.getElementById('guidePointerLine');
  const siteAccessNotice = document.getElementById('siteAccessNotice');
  const context = canvas.getContext('2d', { alpha: true });
  const faceLayer = document.createElement('canvas');
  faceLayer.width = FRAME_WIDTH;
  faceLayer.height = FRAME_HEIGHT;
  const faceContext = faceLayer.getContext('2d', { alpha: true });
  const images = {};
  let availableVoices = [];
  let elevenVoices = [];
  let selectedVoice = null;
  let conversation = [];
  let chatRequestInFlight = false;
  let onlineAvailable = false;
  let localAvailable = false;
  let onlineModel = '';
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const state = {
    x: 0, y: 0, destination: null, onArrival: null,
    gesture: null, speech: null, pendingSpeech: null, blinkUntil: 0, nextBlink: 0,
    lastTick: 0, ready: false, walkStarted: 0, guide: null,
    pointer: { x: 0, y: 0, active: false }, siteUnlocked: false, teleportVersion: 0,
    currentFrame: null, previousFrame: null, frameChangedAt: 0
  };

  function setStatus(message) { status.textContent = message; }
  function setSiteAccess(unlocked) {
    state.siteUnlocked = unlocked;
    document.body.classList.toggle('site-locked', !unlocked);
    document.querySelectorAll('.site-header, main, .site-footer').forEach((section) => { section.inert = !unlocked; });
    siteAccessNotice.classList.toggle('is-unlocked', unlocked);
    siteAccessNotice.textContent = unlocked
      ? 'Cursor granted. You can click site controls. Ask Nova to “take the cursor back” to lock them.'
      : 'Site controls locked. Ask Nova to “give me the cursor.”';
    if (state.guide?.awaiting && state.guide.steps) {
      const step = guideSteps[state.guide.steps[state.guide.index]];
      guideHintText.textContent = `Step ${state.guide.index + 1}/${state.guide.steps.length}: ${step.text}${unlocked ? '' : ' Ask me to “give me the cursor” before clicking.'}`;
    }
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
  function femaleVoiceScore(voice) {
    const name = voice.name.toLowerCase();
    const femaleNames = /\b(aria|jenny|zira|ava|samantha|victoria|hazel|susan|sonia|moira|tessa|serena|kate|salli|joanna|female|woman)\b/;
    const natural = /natural|neural|online/;
    return (femaleNames.test(name) ? 100 : 0) + (natural.test(name) ? 12 : 0)
      + (voice.lang.toLowerCase() === 'en-us' ? 5 : 0);
  }
  function renderVoiceOptions() {
    const previous = voiceSelect.value;
    const browserGroup = document.createElement('optgroup');
    browserGroup.label = 'Browser voices · free';
    if (availableVoices.length) {
      availableVoices.forEach((voice, index) => {
        browserGroup.append(new Option(`${voice.name} (${voice.lang})`, `browser:${index}`));
      });
    } else {
      browserGroup.append(new Option('System default', 'browser:default'));
    }
    const groups = [browserGroup];
    if (elevenVoices.length) {
      const elevenGroup = document.createElement('optgroup');
      elevenGroup.label = 'ElevenLabs voices · uses credits';
      elevenVoices.forEach((voice) => {
        const detail = [voice.gender, voice.accent].filter(Boolean).join(' · ');
        elevenGroup.append(new Option(`${voice.name}${detail ? ` (${detail})` : ''}`, `eleven:${voice.id}`));
      });
      groups.push(elevenGroup);
    }
    voiceSelect.replaceChildren(...groups);
    voiceSelect.value = [...voiceSelect.options].some((option) => option.value === previous)
      ? previous : availableVoices.length ? 'browser:0' : 'browser:default';
    const browserIndex = Number(voiceSelect.value.split(':')[1]);
    selectedVoice = voiceSelect.value.startsWith('browser:') ? availableVoices[browserIndex] || null : null;
  }

  function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices()
      .filter((voice) => voice.lang.toLowerCase().startsWith('en'));
    availableVoices = voices.sort((a, b) => femaleVoiceScore(b) - femaleVoiceScore(a) || a.name.localeCompare(b.name));
    renderVoiceOptions();
  }

  async function loadElevenVoices() {
    try {
      const response = await fetch('/api/voices', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load ElevenLabs voices.');
      elevenVoices = (result.voices || []).sort((a, b) => {
        const aFemale = a.gender?.toLowerCase() === 'female' ? 1 : 0;
        const bFemale = b.gender?.toLowerCase() === 'female' ? 1 : 0;
        return bFemale - aFemale || a.name.localeCompare(b.name);
      });
      renderVoiceOptions();
      voiceNotice.textContent = `${elevenVoices.length} ElevenLabs voices available. Selecting one uses API credits when you press Speak.`;
    } catch (error) {
      voiceNotice.textContent = 'Browser voices are ready. Set ELEVENLABS_API_KEY on the local server to add ElevenLabs voices.';
    }
  }

  function updateProviderNotice() {
    const useOnline = aiProvider.value === 'online';
    localModelRow.hidden = useOnline;
    modelNotice.classList.toggle('error', useOnline ? !onlineAvailable : !localAvailable);
    modelNotice.textContent = useOnline
      ? onlineAvailable ? `Online AI ready · ${onlineModel}` : 'Online AI is not configured. Set OPENAI_API_KEY on the server, or choose Local Ollama.'
      : localAvailable ? `Local Ollama ready · ${modelSelect.value}` : 'Ollama is unavailable or has no models. Start Ollama, install a model, and retry.';
  }

  async function loadAIProviders() {
    modelNotice.classList.remove('error');
    modelNotice.textContent = 'Checking AI connections…';
    try {
      const response = await fetch('/api/online/status', { cache: 'no-store' });
      const result = await response.json();
      onlineAvailable = response.ok && result.available === true;
      onlineModel = typeof result.model === 'string' ? result.model : '';
    } catch { onlineAvailable = false; }
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
    if (!onlineAvailable && localAvailable) aiProvider.value = 'local';
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

  function classifyActionRequest(message) {
    if (/\b(wave|say hi|hello)\b/i.test(message)) return { gesture: 'wave', reply: 'Hello! Here is a wave.' };
    if (/\b(dance|dancing)\b/i.test(message)) return { gesture: 'dance', reply: 'Let me show you my dance.' };
    if (/\b(celebrate|joy|happy)\b/i.test(message)) return { gesture: 'joy', reply: 'Let us celebrate!' };
    return null;
  }

  const workflowContent = {
    listen: { badge: 'STEP 01 · LISTEN', title: 'Start with a question.', text: '“Where can I learn about pricing?” is enough. Nova can recognize this page’s named destinations without needing an AI response first.' },
    guide: { badge: 'STEP 02 · GUIDE', title: 'See the destination.', text: 'Nova scrolls to the right section, teleports next to it, and points with a visible highlight and guide line.' },
    confirm: { badge: 'STEP 03 · CONFIRM', title: 'Finish with your click.', text: 'Nova waits while the visitor chooses the highlighted button. The tour then moves to the next step or returns home.' }
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

  function clearGuideVisuals() {
    document.querySelector('.guide-target-active')?.classList.remove('guide-target-active');
    guideHint.hidden = true;
    guidePointer.hidden = true;
  }

  function endGuide(returnToDock = true) {
    if (state.guide) state.guide.cancelled = true;
    state.guide = null;
    state.teleportVersion += 1;
    actor.classList.remove('teleport-out', 'teleport-in');
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
    endGuide(false);
    const steps = request === 'tour' ? ['features', 'pricing', 'contact'] : [request];
    state.guide = { steps, index: 0, cancelled: false, awaiting: false };
    showGuideStep();
  }

  function showLandmark(element) {
    endGuide(false);
    if (element.matches('[data-integration-category]')) setIntegrationFilter(element.dataset.integrationCategory);
    const focus = element.querySelector('h1,h2,h3') || element;
    const guide = { cancelled: false, awaiting: false, targetElement: focus, landmark: true };
    state.guide = guide;
    const description = element.dataset.guideDescription || `Here is ${element.dataset.guideSpot}.`;
    addChatBubble('assistant', description);
    speak(description, true);
    element.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
    window.setTimeout(() => {
      if (state.guide !== guide || guide.cancelled) return;
      const rect = focus.getBoundingClientRect();
      const size = actorSize();
      const fitsRight = rect.right + size.width + 24 < window.innerWidth;
      const x = fitsRight ? rect.right + 18 : rect.left - size.width - 18;
      const y = rect.top + rect.height / 2 - size.height * 0.52;
      teleportTo(x, y, () => {
        if (state.guide !== guide || guide.cancelled) return;
        guide.awaiting = true;
        focus.classList.add('guide-target-active');
        guidePointer.hidden = false;
        guideHintText.textContent = description;
        guideHint.hidden = false;
        guideHint.style.left = `${Math.max(12, Math.min(window.innerWidth - guideHint.offsetWidth - 12, state.x))}px`;
        guideHint.style.top = `${Math.max(12, state.y - guideHint.offsetHeight - 8)}px`;
        startGesture('point', true);
        window.setTimeout(() => { if (state.guide === guide) endGuide(); }, Math.max(6000, description.length * 65));
      });
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 650);
  }

  function showGuideStep() {
    const guide = state.guide;
    if (!guide || guide.cancelled) return;
    clearGuideVisuals();
    guide.awaiting = false;
    const step = guideSteps[guide.steps[guide.index]];
    const target = document.querySelector(`[data-walkthrough-target="${step.target}"]`);
    if (!target) { endGuide(); return; }
    guide.targetElement = target;
    const instruction = state.siteUnlocked ? step.text : `${step.text} Ask me to “give me the cursor” when you are ready to click.`;
    addChatBubble('assistant', instruction);
    speak(instruction, true);
    target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
    window.setTimeout(() => {
      if (state.guide !== guide || guide.cancelled) return;
      const rect = target.getBoundingClientRect();
      const size = actorSize();
      const rightSide = rect.right + size.width + 24 < window.innerWidth;
      const x = rightSide ? rect.right + 18 : rect.left - size.width - 18;
      const y = rect.top + rect.height / 2 - size.height * 0.55;
      teleportTo(x, y, () => {
        if (state.guide !== guide || guide.cancelled) return;
        guide.awaiting = true;
        target.classList.add('guide-target-active');
        guidePointer.hidden = false;
        guideHintText.textContent = `Step ${guide.index + 1}/${guide.steps.length}: ${instruction}`;
        guideHint.hidden = false;
        const hintX = Math.max(12, Math.min(window.innerWidth - guideHint.offsetWidth - 12, state.x));
        const hintY = Math.max(12, Math.min(window.innerHeight - guideHint.offsetHeight - 12, state.y - guideHint.offsetHeight - 8));
        guideHint.style.left = `${hintX}px`;
        guideHint.style.top = `${hintY}px`;
        startGesture('point', true);
      });
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 650);
  }

  function completeGuideStep(target) {
    const guide = state.guide;
    const step = guide?.steps && guideSteps[guide.steps[guide.index]];
    if (!step || !guide.awaiting || !state.siteUnlocked || target.dataset.walkthroughTarget !== step.target) return false;
    guide.awaiting = false;
    clearGuideVisuals();
    addChatBubble('assistant', step.done);
    speak(step.done, true);
    if (step.target === 'contact') startGesture('joy', true);
    window.setTimeout(() => {
      if (state.guide !== guide || guide.cancelled) return;
      guide.index += 1;
      if (guide.index < guide.steps.length) showGuideStep();
      else endGuide();
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
    if (!message || chatRequestInFlight) return;
    if (/\b(give|grant|unlock|enable|release|need|want)\b.*\b(cursor|mouse|site access|website access)\b|\blet me (use|click|control)\b.*\b(site|website|page)\b/i.test(message)) {
      addChatBubble('user', message);
      speechInput.value = '';
      setSiteAccess(true);
      const reply = 'You have the cursor now. You can click the highlighted control.';
      addChatBubble('assistant', reply);
      speak(reply, true);
      return;
    }
    if (/\b(take (?:the |my )?cursor back|hide (?:the )?cursor|lock (?:the )?(?:site|website|page)|disable (?:site )?controls)\b/i.test(message)) {
      addChatBubble('user', message);
      speechInput.value = '';
      setSiteAccess(false);
      const reply = 'The site controls are locked again. Ask me whenever you want the cursor back.';
      addChatBubble('assistant', reply);
      speak(reply, true);
      return;
    }
    if (/^(stop|cancel|skip)(?: (?:the )?(?:tour|walkthrough))?[.!]?$/i.test(message)) {
      addChatBubble('user', message);
      speechInput.value = '';
      endGuide();
      addChatBubble('assistant', 'Okay, I stopped the walkthrough. Ask me when you want to start again.');
      speak('Okay, I stopped the walkthrough.', true);
      return;
    }
    const guideRequest = classifyGuideRequest(message);
    if (guideRequest) {
      addChatBubble('user', message);
      speechInput.value = '';
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
      showLandmark(landmark);
      return;
    }
    const wasGuiding = Boolean(state.guide);
    endGuide(wasGuiding);
    chatRequestInFlight = true;
    askButton.disabled = true;
    askButton.textContent = '…';
    addChatBubble('user', message);
    speechInput.value = '';
    setStatus('Thinking…');
    modelNotice.classList.remove('error');
    const useOnline = aiProvider.value === 'online';
    modelNotice.textContent = useOnline ? 'Nova is thinking online…' : 'Nova is thinking on your local model…';
    try {
      const response = await fetch(useOnline ? '/api/online/chat' : '/api/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, model: modelSelect.value, history: conversation.slice(-8) }),
        cache: 'no-store'
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The AI could not answer.');
      addChatBubble('assistant', result.reply);
      conversation.push({ role: 'user', content: message }, { role: 'assistant', content: result.reply });
      conversation = conversation.slice(-8);
      modelNotice.textContent = `Answered by ${result.model} · voice: ${voiceSelect.selectedOptions[0]?.textContent || 'browser'}`;
      speak(result.reply, wasGuiding);
    } catch (error) {
      const detail = error.message || 'Could not contact the AI.';
      addChatBubble('assistant', `I could not answer: ${detail}`);
      modelNotice.classList.add('error');
      modelNotice.textContent = detail;
      setStatus('AI unavailable');
    } finally {
      chatRequestInFlight = false;
      askButton.disabled = false;
      askButton.textContent = 'Ask';
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
    const overlapsPanel = position.x < panel.right && position.x + width > panel.left
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

  function teleportTo(x, y, onArrival) {
    const destination = clampPosition(x, y);
    const version = ++state.teleportVersion;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.destination = null;
    state.onArrival = null;
    state.gesture = null;
    actor.classList.remove('teleport-in');
    setStatus('Teleporting to your destination');
    if (!reducedMotion) {
      teleportBurst();
      actor.classList.add('teleport-out');
    }
    window.setTimeout(() => {
      if (version !== state.teleportVersion) return;
      state.x = destination.x;
      state.y = destination.y;
      placeActor();
      actor.classList.remove('teleport-out');
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
    }, reducedMotion ? 0 : 300);
  }

  function startGesture(type, keepSpeech = false) {
    const duration = { point: 2200, wave: 2500, dance: 4000, joy: 2400 }[type];
    if (!duration) return;
    if (!keepSpeech) cancelSpeech();
    state.destination = null;
    state.onArrival = null;
    state.gesture = { type, started: performance.now(), duration };
    setStatus({ point: 'Pointing', wave: 'Waving', dance: 'Dancing', joy: 'Feeling joyful' }[type]);
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
      const estimatedIndex = elapsed / speech.estimatedDuration * speech.text.length;
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
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.pitch = selectedVoice && femaleVoiceScore(selectedVoice) >= 100 ? 1.04 : 1.22;
      utterance.rate = 0.95;
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

  async function speakWithElevenLabs(message, voiceId) {
    const requestController = new AbortController();
    state.pendingSpeech = requestController;
    setStatus('Thinking…');
    try {
      const response = await fetch('/api/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message, voiceId }),
        signal: requestController.signal,
        cache: 'no-store'
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'ElevenLabs could not generate speech.');
      if (state.pendingSpeech !== requestController) return;
      state.pendingSpeech = null;
      const encoded = atob(result.audioBase64);
      const audioBytes = Uint8Array.from(encoded, (character) => character.charCodeAt(0));
      const audioUrl = URL.createObjectURL(new Blob([audioBytes], { type: 'audio/mpeg' }));
      const audio = new Audio(audioUrl);
      const speech = createSpeechState(message, result.alignment, audio, audioUrl);
      state.speech = speech;
      audio.onplay = () => {
        if (state.speech !== speech) return;
        speech.started = performance.now();
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
      setStatus('Voice unavailable');
      voiceNotice.textContent = error.message || 'ElevenLabs speech failed. Try a browser voice.';
    }
  }

  function speak(text, keepMovement = false) {
    const message = String(text || '').trim();
    if (!message) return;
    const selection = voiceSelect.value;
    cancelSpeech();
    if (!keepMovement) {
      state.destination = null;
      state.onArrival = null;
      state.gesture = null;
    }
    if (selection.startsWith('eleven:')) {
      speakWithElevenLabs(message, selection.slice('eleven:'.length));
    } else {
      speakWithBrowser(message);
    }
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
      if (!state.siteUnlocked) return;
      if (completeGuideStep(button)) return;
      addChatBubble('assistant', 'Ask me in chat to guide you here, and I will show you the next step.');
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
  document.getElementById('retryModels').addEventListener('click', loadAIProviders);
  aiProvider.addEventListener('change', updateProviderNotice);
  modelSelect.addEventListener('change', updateProviderNotice);
  document.getElementById('avatarHit').addEventListener('click', () => {
    if (!state.guide) speak('Hi! Type “show me the site” in chat and I will guide you.');
  });
  voiceSelect.addEventListener('change', () => {
    const browserIndex = Number(voiceSelect.value.split(':')[1]);
    selectedVoice = voiceSelect.value.startsWith('browser:') ? availableVoices[browserIndex] || null : null;
  });
  document.getElementById('skipGuide').addEventListener('click', () => endGuide());
  window.addEventListener('resize', () => {
    Object.assign(state, state.guide ? clampPosition(state.x, state.y) : dockPosition());
    if (state.destination) state.destination = clampPosition(state.destination.x, state.destination.y);
    placeActor();
  });

  const initial = dockPosition();
  state.x = initial.x;
  state.y = initial.y;
  state.nextBlink = performance.now() + 2400;
  setSiteAccess(false);
  placeActor();
  requestAnimationFrame(animate);
  renderVoiceOptions();
  loadVoices();
  loadElevenVoices();
  loadAIProviders();
  window.addEventListener('nova3dready', () => {
    state.ready = true;
    if (!state.guide && !state.destination) {
      Object.assign(state, dockPosition());
      placeActor();
    }
    setStatus('Ready to guide');
  });
  if ('speechSynthesis' in window) window.speechSynthesis.addEventListener('voiceschanged', loadVoices);

  function loadSpriteFallback() {
    if (window.Nova3D?.ready) return;
    Promise.all(Object.entries(atlasFiles).map(([name, file]) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => { images[name] = image; resolve(); };
      image.onerror = () => reject(new Error(`Could not load avatar/${file}`));
      image.src = new URL(`avatar/${file}`, document.baseURI).href;
    }))).then(() => {
      if (window.Nova3D?.ready) return;
      state.ready = true;
      setStatus('Ready to guide');
    }).catch((error) => {
      console.error(error);
      if (!window.Nova3D?.ready) setStatus('Character art could not load');
    });
  }
  window.addEventListener('nova3dfailed', loadSpriteFallback, { once: true });
  window.setTimeout(loadSpriteFallback, 1500);
})();
