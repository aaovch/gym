import assert from 'node:assert/strict';
import test from 'node:test';

import { COMPLETION_PHRASES, completionPhrase } from './completion-phrases';

test('completion phrase stays stable for one completed exercise', () => {
  const seed = 'meso-12:micro-4:1:Румынская тяга:2026-08-17';
  assert.equal(completionPhrase(seed), completionPhrase(seed));
});

test('completion phrase pool is compact, varied and unique', () => {
  assert.ok(COMPLETION_PHRASES.length >= 20);
  assert.equal(new Set(COMPLETION_PHRASES).size, COMPLETION_PHRASES.length);
  assert.ok(COMPLETION_PHRASES.every((phrase) => phrase.length <= 24));
  assert.ok(new Set(Array.from({ length: 16 }, (_, index) => completionPhrase(`exercise-${index}`))).size > 8);
});
