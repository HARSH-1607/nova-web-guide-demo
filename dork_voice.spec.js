#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const voice = require('./dork-voice.js');

const ranked = voice.rank([
  { name: 'Microsoft Zira', lang: 'en-US' },
  { name: 'Microsoft David', lang: 'en-US' },
  { name: 'Neutral Neural', lang: 'en-GB' },
  { name: 'French voice', lang: 'fr-FR' }
]);
assert.equal(ranked[0].name, 'Microsoft David');
assert.equal(ranked.at(-1).name, 'Microsoft Zira');
assert.equal(ranked.length, 3);
const utterance = {};
voice.apply(utterance, ranked[0]);
assert.equal(utterance.voice.name, 'Microsoft David');
assert.equal(utterance.pitch, 0.92);
assert.ok(utterance.rate < 1);
const fallback = {};
voice.apply(fallback, null);
assert.equal(fallback.lang, 'en-US');
assert.equal(fallback.pitch, 0.8);
console.log('Masculine browser voice selection tests passed.');
