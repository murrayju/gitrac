#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { paginate, search } from './notes.js';

const notes = JSON.parse(readFileSync('notes.json', 'utf8'));
const [command, ...args] = process.argv.slice(2);

if (command === 'search') {
  for (const note of search(notes, args.join(' '))) console.log(note.text);
} else {
  const page = Number(args[0] ?? 1);
  for (const note of paginate(notes, page, 10)) console.log(note.text);
}
