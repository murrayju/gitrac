import assert from 'node:assert/strict';
import { test } from 'node:test';
import { search } from '../src/notes.js';

test('search finds matching notes', () => {
  const notes = [{ text: 'buy milk' }, { text: 'call mom' }];
  assert.deepEqual(search(notes, 'milk'), [{ text: 'buy milk' }]);
});
