#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const voice = require('./dork-voice.js');

const ranked = voice.rank([
  { name: 'Microsoft Zira', lang: 'en-US' },
  { name: 'Microsoft David', lang: 'en-US' },
  { name: 'Google UK English Male', lang: 'en-GB' },
  { name: 'Neutral Neural', lang: 'en-GB' },
  { name: 'French voice', lang: 'fr-FR' }
]);
assert.equal(ranked[0].name, 'Google UK English Male');
assert.equal(ranked.at(-1).name, 'Microsoft Zira');
assert.equal(ranked.length, 4);
const utterance = {};
voice.apply(utterance, ranked[0]);
assert.equal(utterance.voice.name, 'Google UK English Male');
assert.equal(utterance.pitch, 1);
assert.ok(utterance.rate < 1);
const fallback = {};
voice.apply(fallback, null);
assert.equal(fallback.lang, 'en-GB');
assert.equal(fallback.pitch, 0.8);
console.log('Masculine browser voice selection tests passed.');
