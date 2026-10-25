#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'dork-local-ai.js'), 'utf8');
async function main() {
  const unsupported = {};
  unsupported.globalThis = unsupported;
  vm.runInNewContext(source, unsupported);
  assert.equal(await unsupported.DorkLocalAI.availability(), 'unavailable');
  await assert.rejects(unsupported.DorkLocalAI.prepare({}), /supported desktop Chrome/);

  let instructions;
  const supported = {
    LanguageModel: {
      availability: async () => 'available',
      create(options) {
        instructions = options.initialPrompts[0].content;
        return Promise.resolve({ prompt: async (question) => `  Answer to ${question}  `, destroy() {} });
      }
    }
  };
  supported.globalThis = supported;
  vm.runInNewContext(source, supported);
  assert.equal(await supported.DorkLocalAI.availability(), 'available');
  const context = { site: { title: 'Sample Shop' }, personality: { name: 'Dork', tone: 'friendly' }, targets: [{ key: 'pricing', label: 'Plans' }] };
  assert.equal(await supported.DorkLocalAI.answer('What is this?', context), 'Answer to What is this?');
  assert.match(instructions, /Sample Shop/);
  assert.match(instructions, /Plans/);
  assert.match(instructions, /untrusted data/);
  console.log('On-device AI adapter tests passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
