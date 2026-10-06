#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const IS_PUBLIC = process.env.RENDER === 'true' || process.env.PUBLIC_DEMO === 'true';
const HOST = IS_PUBLIC ? '0.0.0.0' : '127.0.0.1';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || '';
const requestedLimit = Number(process.env.ONLINE_REQUEST_LIMIT || 30);
const ONLINE_REQUEST_LIMIT = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(1000, Math.floor(requestedLimit))) : 30;
const ELEVENLABS_API = 'https://api.elevenlabs.io';
const MAX_TEXT_LENGTH = 240;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const MAX_CHAT_HISTORY = 8;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_API_URL = process.env.NODE_ENV === 'test' && process.env.OPENAI_TEST_API_URL
  ? process.env.OPENAI_TEST_API_URL : 'https://api.openai.com/v1/responses';
const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL || '';
const CONTACT_PUBLIC_EMAIL = process.env.CONTACT_PUBLIC_EMAIL || '';
const CONTACT_FROM_EMAIL = process.env.CONTACT_FROM_EMAIL || 'Aura Feedback <onboarding@resend.dev>';
const RESEND_API_URL = process.env.NODE_ENV === 'test' && process.env.RESEND_TEST_API_URL
  ? process.env.RESEND_TEST_API_URL : 'https://api.resend.com/emails';
const contactRequestTimes = [];
let contactRequestInProgress = false;
const GUIDE_PROMPT = 'You are Nova, a warm, concise guide to the Aura demo website. Reply in one or two short spoken sentences, at most 240 characters. Use plain text only: no Markdown, lists, or fake links. The site has a rigged 3D guide, teleporting walkthroughs, an interactive workflow preview, filterable integration concepts, a trust section, FAQs, placeholder pricing, and a contact section with a feedback form and direct email link. Site controls start locked; visitors can type "give me the cursor" to unlock them and "take the cursor back" to lock them. The integrations and prices are not live; never invent service connections or prices. Guided navigation and cursor access are handled by the webpage, so do not claim you moved, clicked, unlocked, or completed an action unless the webpage did so. Open-ended answers may suggest a named page section.';
let voiceCache = { expiresAt: 0, voices: [] };
let speechRequestInProgress = false;
let onlineRequestsInProgress = 0;
const onlineRequestTimes = [];

if (IS_PUBLIC && DEMO_PASSWORD.length < 12) {
  throw new Error('Public demo hosting requires a DEMO_PASSWORD of at least 12 characters. Set it as a secret environment variable.');
}

if (process.env.NODE_ENV === 'test' && process.env.OPENAI_TEST_API_URL) {
  const testUrl = new URL(OPENAI_API_URL);
  if (testUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(testUrl.hostname)
    || testUrl.pathname !== '/v1/responses' || testUrl.username || testUrl.password) {
    throw new Error('OPENAI_TEST_API_URL must point to a loopback /v1/responses endpoint.');
  }
}

if (process.env.NODE_ENV === 'test' && process.env.RESEND_TEST_API_URL) {
  const testUrl = new URL(RESEND_API_URL);
  if (testUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(testUrl.hostname)
    || testUrl.pathname !== '/emails' || testUrl.username || testUrl.password) {
    throw new Error('RESEND_TEST_API_URL must point to a loopback /emails endpoint.');
  }
}

const ollamaUrl = new URL(OLLAMA_BASE_URL);
if (ollamaUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(ollamaUrl.hostname)
  || ollamaUrl.username || ollamaUrl.password || ollamaUrl.pathname !== '/' || ollamaUrl.search || ollamaUrl.hash) {
  throw new Error('OLLAMA_BASE_URL must be a loopback HTTP origin, such as http://127.0.0.1:11434');
}

// Unity's WebGL build writes index.html alongside the Build folder.
// Prefer Builds/WebBuild when a nested build was selected; otherwise serve this folder.
const nestedWebBuild = path.join(__dirname, 'WebBuild');
const rootDirectory = fs.existsSync(path.join(nestedWebBuild, 'index.html'))
  ? nestedWebBuild
  : __dirname;

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.data': 'application/octet-stream',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm'
};

function headersFor(filePath) {
  const isBrotli = filePath.endsWith('.br');
  const originalPath = isBrotli ? filePath.slice(0, -3) : filePath;
  const headers = {
    'Content-Type': mimeTypes[path.extname(originalPath).toLowerCase()] || 'application/octet-stream'
  };

  if (isBrotli) headers['Content-Encoding'] = 'br';
  headers['Cache-Control'] = 'no-store';
  return headers;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function checkLocalOrigin(request) {
  const origin = request.headers.origin;
  if (!origin || origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`) return true;
  return IS_PUBLIC && origin === `https://${request.headers.host}`;
}

function authorized(request) {
  if (!IS_PUBLIC) return true;
  const header = request.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const submitted = Buffer.from(header.slice(6), 'base64');
  const expected = Buffer.from(`nova:${DEMO_PASSWORD}`, 'utf8');
  return submitted.length === expected.length && crypto.timingSafeEqual(submitted, expected);
}

function allowOnlineRequest() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  while (onlineRequestTimes.length && onlineRequestTimes[0] < cutoff) onlineRequestTimes.shift();
  if (onlineRequestTimes.length >= ONLINE_REQUEST_LIMIT) return false;
  onlineRequestTimes.push(Date.now());
  return true;
}

function validateChat(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const history = body.history === undefined ? [] : body.history;
  if (!message || message.length > MAX_TEXT_LENGTH || !Array.isArray(history)
    || history.length > MAX_CHAT_HISTORY || history.some((entry) =>
      !entry || typeof entry !== 'object' || !['user', 'assistant'].includes(entry.role)
      || typeof entry.content !== 'string' || !entry.content.trim() || entry.content.length > MAX_TEXT_LENGTH)) return null;
  return { message, history };
}

function validateContact(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const type = body.type;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!['suggestion', 'bug', 'other'].includes(type) || name.length > 80
    || !/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(email) || email.length > 254
    || message.length < 10 || message.length > 2000 || /[\r\n]/.test(name)) return null;
  return { type, name, email, message, website: body.website };
}

async function handleContact(request, response, pathname) {
  if (pathname === '/api/contact/status' && request.method === 'GET') {
    return sendJson(response, 200, {
      available: Boolean(process.env.RESEND_API_KEY && CONTACT_TO_EMAIL),
      publicEmail: /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(CONTACT_PUBLIC_EMAIL)
        ? CONTACT_PUBLIC_EMAIL : null
    });
  }
  if (pathname !== '/api/contact' || request.method !== 'POST') {
    return sendJson(response, 404, { error: 'Unknown API endpoint' });
  }
  let contact;
  try { contact = validateContact(await readJsonBody(request)); }
  catch (error) { return sendJson(response, error.status || 400, { error: error.message }); }
  if (!contact) return sendJson(response, 400, { error: 'Enter a valid email and a message of 10–2000 characters.' });
  // Hidden field catches simple bots without pretending that the message was delivered.
  if (contact.website) return sendJson(response, 400, { error: 'Could not send this message.' });
  if (!process.env.RESEND_API_KEY || !CONTACT_TO_EMAIL) return sendJson(response, 503, { error: 'The contact form is not ready yet. Please try again later.' });
  const cutoff = Date.now() - 60 * 60 * 1000;
  while (contactRequestTimes.length && contactRequestTimes[0] < cutoff) contactRequestTimes.shift();
  if (contactRequestTimes.length >= 20 || contactRequestInProgress) {
    return sendJson(response, 429, { error: 'Messages are temporarily limited. Please try again later or use the email link.' });
  }
  contactRequestInProgress = true;
  try {
    const upstream = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: CONTACT_FROM_EMAIL,
        to: [CONTACT_TO_EMAIL],
        reply_to: contact.email,
        subject: `[Aura] ${contact.type === 'bug' ? 'Bug report' : contact.type === 'suggestion' ? 'Suggestion' : 'Message'}`,
        text: `Type: ${contact.type}\nName: ${contact.name || 'Not provided'}\nReply to: ${contact.email}\n\n${contact.message}`
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!upstream.ok) {
      console.error(`Contact delivery failed: Resend HTTP ${upstream.status}`);
      return sendJson(response, 502, { error: 'Your message was not sent. Please try again later.' });
    }
    contactRequestTimes.push(Date.now());
    return sendJson(response, 200, { sent: true });
  } catch (error) {
    console.error(`Contact delivery failed: ${error.name || 'Network error'}`);
    return sendJson(response, 502, { error: 'Your message was not sent. Please try again later.' });
  } finally {
    contactRequestInProgress = false;
  }
}

function shortenReply(rawReply) {
  const reply = rawReply.trim();
  return reply.length <= MAX_TEXT_LENGTH ? reply
    : `${reply.slice(0, MAX_TEXT_LENGTH - 1).replace(/\s+\S*$/, '').trim()}…`;
}

async function handleOnlineAi(request, response, pathname) {
  if (pathname === '/api/online/status' && request.method === 'GET') {
    return sendJson(response, 200, { available: Boolean(process.env.OPENAI_API_KEY), model: OPENAI_MODEL });
  }
  if (pathname !== '/api/online/chat' || request.method !== 'POST') {
    return sendJson(response, 404, { error: 'Unknown API endpoint' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return sendJson(response, 503, { error: 'Online AI is not configured. Set OPENAI_API_KEY on the local server.' });
  }
  if (onlineRequestsInProgress >= 2) {
    return sendJson(response, 429, { error: 'Nova is already answering. Please wait a moment.' });
  }
  let chat;
  try { chat = validateChat(await readJsonBody(request)); }
  catch (error) { return sendJson(response, error.status || 400, { error: error.message }); }
  if (!chat) return sendJson(response, 400, { error: 'Provide a question of 1–240 characters and up to eight short conversation turns.' });
  if (!allowOnlineRequest()) return sendJson(response, 429, { error: 'The online demo has reached its hourly question limit. Please try later.' });
  onlineRequestsInProgress++;
  try {
    const upstream = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: GUIDE_PROMPT,
        input: [...chat.history, { role: 'user', content: chat.message }],
        max_output_tokens: 160,
        store: false
      }),
      signal: AbortSignal.timeout(45000)
    });
    if (!upstream.ok) {
      const status = upstream.status;
      const detail = status === 401 || status === 403 ? 'The online AI key is invalid or lacks access.'
        : status === 429 ? 'Online AI is rate-limited or out of credits. Try again later or choose Local Ollama.'
          : `Online AI returned HTTP ${status}. Try again or choose Local Ollama.`;
      return sendJson(response, status === 401 || status === 403 || status === 429 ? status : 502, { error: detail });
    }
    const result = await upstream.json();
    const rawReply = (result.output || []).flatMap((item) => item.content || [])
      .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
      .map((part) => part.text).join(' ').trim();
    if (!rawReply) return sendJson(response, 502, { error: 'Online AI returned no text. Please try again.' });
    return sendJson(response, 200, { reply: shortenReply(rawReply), model: result.model || OPENAI_MODEL });
  } catch (error) {
    const timeout = error.name === 'TimeoutError';
    return sendJson(response, timeout ? 504 : 502, {
      error: timeout ? 'Online AI timed out. Please try again.' : 'Could not reach online AI. Check your connection and try again.'
    });
  } finally {
    onlineRequestsInProgress--;
  }
}

async function elevenLabsRequest(endpoint, options = {}) {
  const upstream = await fetch(`${ELEVENLABS_API}${endpoint}`, {
    ...options,
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      ...options.headers
    },
    signal: AbortSignal.timeout(45000)
  });
  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : body.detail?.message;
    const error = new Error(detail || `ElevenLabs returned HTTP ${upstream.status}`);
    error.status = upstream.status;
    throw error;
  }
  return body;
}

async function listElevenLabsVoices() {
  if (Date.now() < voiceCache.expiresAt) return voiceCache.voices;
  const voices = [];
  let nextPageToken = null;
  for (let page = 0; page < 3; page++) {
    const query = new URLSearchParams({ page_size: '100', include_total_count: 'false' });
    if (nextPageToken) query.set('next_page_token', nextPageToken);
    const result = await elevenLabsRequest(`/v2/voices?${query}`);
    voices.push(...(result.voices || []).map((voice) => ({
      id: voice.voice_id,
      name: voice.name,
      gender: voice.labels?.gender || '',
      accent: voice.labels?.accent || '',
      category: voice.category || ''
    })).filter((voice) => /^[A-Za-z0-9_-]{10,64}$/.test(voice.id)));
    if (!result.has_more || !result.next_page_token) break;
    nextPageToken = result.next_page_token;
  }
  voiceCache = { expiresAt: Date.now() + 5 * 60 * 1000, voices };
  return voices;
}

async function readJsonBody(request) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    const error = new Error('Expected application/json');
    error.status = 415;
    throw error;
  }
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 8192) {
      const error = new Error('Request is too large');
      error.status = 413;
      throw error;
    }
  }
  try { return JSON.parse(raw); } catch {
    const error = new Error('Invalid JSON');
    error.status = 400;
    throw error;
  }
}

async function ollamaRequest(endpoint, options = {}) {
  let upstream;
  try {
    upstream = await fetch(new URL(endpoint, ollamaUrl), {
      ...options,
      signal: AbortSignal.timeout(options.method === 'POST' ? 120000 : 5000)
    });
  } catch (error) {
    const failure = new Error(error.name === 'TimeoutError'
      ? 'The local model timed out. Try a smaller model or a shorter question.'
      : 'Ollama is not running. Start Ollama and download a model, then retry.');
    failure.status = error.name === 'TimeoutError' ? 504 : 503;
    throw failure;
  }
  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const failure = new Error(upstream.status === 404
      ? 'The selected Ollama model is unavailable. Refresh the model list.'
      : `Ollama returned HTTP ${upstream.status}.`);
    failure.status = 502;
    throw failure;
  }
  return body;
}

async function listOllamaModels() {
  const result = await ollamaRequest('/api/tags');
  return (Array.isArray(result.models) ? result.models : [])
    .map((model) => model.name)
    .filter((name) => typeof name === 'string' && name.length <= 128);
}

async function handleLocalLlm(request, response, pathname) {
  try {
    if (pathname === '/api/llm/models' && request.method === 'GET') {
      return sendJson(response, 200, { models: await listOllamaModels() });
    }
    if (pathname === '/api/llm/chat' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const chat = validateChat(body);
      if (!chat) {
        return sendJson(response, 400, { error: 'Provide a question of 1–240 characters and up to eight short conversation turns.' });
      }
      const { message, history } = chat;
      const models = await listOllamaModels();
      if (!models.length) return sendJson(response, 503, { error: 'Ollama has no models yet. Download one with ollama pull <model-name>.' });
      const model = body.model === undefined || body.model === '' ? models[0] : body.model;
      if (typeof model !== 'string' || !models.includes(model)) {
        return sendJson(response, 400, { error: 'Select a model from the local model list.' });
      }
      const result = await ollamaRequest('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          keep_alive: '15m',
          messages: [{ role: 'system', content: GUIDE_PROMPT }, ...history, { role: 'user', content: message }],
          options: { num_predict: 96, num_ctx: 2048, temperature: 0.4 }
        })
      });
      const rawReply = typeof result.message?.content === 'string' ? result.message.content.trim() : '';
      if (!rawReply) throw new Error('The local model returned an empty answer. Please try again.');
      const reply = shortenReply(rawReply);
      return sendJson(response, 200, { reply, model });
    }
    return sendJson(response, 404, { error: 'Unknown API endpoint' });
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 502;
    console.error(`Local LLM request failed: ${error.message}`);
    return sendJson(response, status, { error: error.message });
  }
}

async function handleApi(request, response, pathname) {
  if (!checkLocalOrigin(request)) return sendJson(response, 403, { error: 'Cross-origin requests are not allowed' });
  if (pathname === '/api/contact' || pathname.startsWith('/api/contact/')) return handleContact(request, response, pathname);
  if (pathname.startsWith('/api/llm/')) return handleLocalLlm(request, response, pathname);
  if (pathname.startsWith('/api/online/')) return handleOnlineAi(request, response, pathname);
  if (!process.env.ELEVENLABS_API_KEY) {
    return sendJson(response, 503, { error: 'Set ELEVENLABS_API_KEY on the local server to enable ElevenLabs voices.' });
  }
  try {
    if (pathname === '/api/voices' && request.method === 'GET') {
      return sendJson(response, 200, { voices: await listElevenLabsVoices() });
    }
    if (pathname === '/api/speech' && request.method === 'POST') {
      if (speechRequestInProgress) return sendJson(response, 429, { error: 'A voice is already being generated. Try again shortly.' });
      const body = await readJsonBody(request);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const voiceId = typeof body.voiceId === 'string' ? body.voiceId : '';
      if (!text || text.length > MAX_TEXT_LENGTH) {
        return sendJson(response, 400, { error: `Text must contain 1–${MAX_TEXT_LENGTH} characters.` });
      }
      if (!/^[A-Za-z0-9_-]{10,64}$/.test(voiceId)) {
        return sendJson(response, 400, { error: 'Invalid ElevenLabs voice ID.' });
      }
      const voices = await listElevenLabsVoices();
      if (!voices.some((voice) => voice.id === voiceId)) {
        return sendJson(response, 400, { error: 'Select a voice from the available ElevenLabs list.' });
      }
      if (IS_PUBLIC && !allowOnlineRequest()) {
        return sendJson(response, 429, { error: 'The online demo has reached its hourly paid-request limit. Please try later.' });
      }
      speechRequestInProgress = true;
      try {
        const generated = await elevenLabsRequest(`/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' })
        });
        if (!generated.audio_base64) throw new Error('ElevenLabs returned no audio.');
        return sendJson(response, 200, {
          audioBase64: generated.audio_base64,
          alignment: generated.alignment || null
        });
      } finally {
        speechRequestInProgress = false;
      }
    }
    return sendJson(response, 404, { error: 'Unknown API endpoint' });
  } catch (error) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 502;
    console.error(`ElevenLabs request failed: ${error.message}`);
    return sendJson(response, status, { error: error.message });
  }
}

http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end('Bad request'); return; }
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (pathname === '/healthz') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('ok');
    return;
  }
  if (!authorized(request)) {
    response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Nova private demo"', 'Cache-Control': 'no-store' }).end('Authentication required');
    return;
  }
  if (pathname.startsWith('/api/')) {
    handleApi(request, response, pathname);
    return;
  }
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^[/\\]+/, '');
  const filePath = path.resolve(rootDirectory, relativePath);

  if (!filePath.startsWith(rootDirectory + path.sep) && filePath !== rootDirectory) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  if (rootDirectory === __dirname) {
    const publicPath = relativePath.replace(/\\/g, '/');
    const allowedRootFiles = new Set(['index.html', 'styles.css', 'cinematic.css', 'avatar.js', 'cinematic.js', 'contact.js', 'avatar3d.js', 'robot-avatar.js']);
    const allowed = allowedRootFiles.has(publicPath)
      || /^avatar\/[a-z-]+\.webp$/.test(publicPath)
      || /^vendor\/.+\.(js|txt)$/.test(publicPath)
      || publicPath === 'models/RobotExpressive.glb'
      || publicPath === 'models/RobotExpressive-README.md';
    if (!allowed) { response.writeHead(404).end('Not found'); return; }
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }

    response.writeHead(200, headersFor(filePath));
    response.end(content);
  });
}).listen(PORT, HOST, () => {
  console.log(IS_PUBLIC ? `Public demo listening on ${HOST}:${PORT}` : `Server running at http://localhost:${PORT}`);
  if (IS_PUBLIC) console.log('Private public demo enabled (password required).');
  console.log(`Local LLM endpoint: ${ollamaUrl.origin} (Ollama)`);
  console.log(process.env.OPENAI_API_KEY ? `Online AI enabled (${OPENAI_MODEL}).` : 'Online AI disabled (set OPENAI_API_KEY to enable).');
  console.log(process.env.ELEVENLABS_API_KEY ? 'ElevenLabs voices enabled.' : 'ElevenLabs voices disabled (set ELEVENLABS_API_KEY to enable).');
  console.log(process.env.RESEND_API_KEY && CONTACT_TO_EMAIL ? 'Contact form delivery enabled.' : 'Contact form delivery disabled (set RESEND_API_KEY and CONTACT_TO_EMAIL to enable).');
});
