/* Shared browser-voice fallback for the Aura site and portable Dork embed. */
(function (root) {
  'use strict';

  const masculineNames = /\b(david|mark|guy|christopher|eric|andrew|ryan|brian|alex|daniel|oliver|thomas|fred|arthur|james|george|matthew|adam|male|man)\b/i;
  const feminineNames = /\b(aria|jenny|zira|ava|samantha|victoria|hazel|susan|sonia|moira|tessa|serena|kate|salli|joanna|female|woman)\b/i;

  function score(voice) {
    const name = String(voice?.name || '');
    const language = String(voice?.lang || '').toLowerCase();
    if (!language.startsWith('en')) return -Infinity;
    return (/^google uk english male$/i.test(name.trim()) ? 1000 : 0)
      + (masculineNames.test(name) ? 100 : 0)
      - (feminineNames.test(name) ? 100 : 0)
      + (/natural|neural|online/i.test(name) ? 10 : 0)
      + (language === 'en-gb' ? 8 : 0)
      + (language === 'en-us' ? 4 : 0);
  }

  function rank(voices) {
    return Array.from(voices || []).filter((voice) => score(voice) > -Infinity)
      .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  }

  function apply(utterance, voice, tone = 'friendly') {
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'en-GB';
    utterance.rate = tone === 'professional' ? 0.9 : tone === 'playful' ? 0.98 : 0.94;
    utterance.pitch = voice && /^google uk english male$/i.test(voice.name.trim())
      ? 1 : voice && masculineNames.test(voice.name) ? 0.92 : 0.8;
    return utterance;
  }

  const api = { score, rank, apply };
  root.DorkVoice = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
