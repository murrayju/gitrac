import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guards against regressing to one SSE connection per hook/component: every
// `EventSource` in the tab exhausts one of the browser's ~6 per-host slots.
const uiDir = join(import.meta.dir, '..');

function uiSources(): { path: string; text: string }[] {
  const glob = new Bun.Glob('**/*.{ts,tsx}');
  return [...glob.scanSync(uiDir)]
    .filter((p) => !p.endsWith('.test.ts'))
    .map((p) => ({ path: p, text: readFileSync(join(uiDir, p), 'utf8') }));
}

describe('web UI connection sharing', () => {
  test('only lib/event-stream.ts creates an EventSource', () => {
    const offenders = uiSources()
      .filter((f) => /new\s+EventSource\s*\(/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual(['lib/event-stream.ts']);
  });

  test('config is only fetched by the shared store in hooks.ts', () => {
    const offenders = uiSources()
      .filter((f) => f.path !== 'api.ts' && /\bfetchConfig\b/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual(['hooks.ts']);
  });
});
