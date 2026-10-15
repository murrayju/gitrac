import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { uploadImage } from './image-upload-plugin.ts';
import { getEditorMarkdown } from './markdown.ts';

// Tiptap needs a DOM (tiptap-markdown parses via DOMParser)
beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const realFetch = globalThis.fetch;
const editors: Editor[] = [];
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const editor of editors.splice(0)) editor.destroy();
});

function makeEditor(content: string): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: false }),
      Markdown.configure({ html: false }),
    ],
    content,
  });
  editors.push(editor);
  return editor;
}

/** Make every fetch() answer with `response` (or reject with it). */
function mockFetch(response: Response | Error): void {
  globalThis.fetch = (async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
}

const png = () => new File([new Uint8Array([1, 2, 3])], 'shot.png');

describe('uploadImage', () => {
  test('inserts the uploaded image on success', async () => {
    mockFetch(
      Response.json(
        { filename: 'x.png', url: '/.issues/assets/x.png' },
        { status: 201 },
      ),
    );
    const editor = makeEditor('Hello');
    const errors: string[] = [];
    const ok = await uploadImage(editor.view, png(), {
      onError: (m) => errors.push(m),
    });
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
    expect(getEditorMarkdown(editor)).toContain(
      '![shot.png](/.issues/assets/x.png)',
    );
  });

  test.each([
    [
      'unsupported type',
      Response.json({ error: 'Unsupported file type: .svg' }, { status: 400 }),
      'Couldn\'t upload "shot.png": Unsupported file type: .svg',
    ],
    [
      'too large',
      Response.json(
        { error: 'Upload too large (max 10 MiB)' },
        { status: 413 },
      ),
      'Couldn\'t upload "shot.png": Upload too large (max 10 MiB)',
    ],
    [
      'server error',
      new Response('<html>Bad Gateway</html>', { status: 502 }),
      'Couldn\'t upload "shot.png": Server error (HTTP 502)',
    ],
    [
      'network error',
      new TypeError('Failed to fetch'),
      'Couldn\'t upload "shot.png": Network error: could not reach the server',
    ],
  ])('%s: reports the error and leaves the document untouched', async (_, response, message) => {
    mockFetch(response);
    const editor = makeEditor('Hello');
    const before = editor.getJSON();
    const errors: string[] = [];
    let started = 0;
    const ok = await uploadImage(editor.view, png(), {
      onError: (m) => errors.push(m),
      onStart: () => started++,
    });
    expect(ok).toBe(false);
    expect(started).toBe(1);
    expect(errors).toEqual([message]);
    expect(editor.getJSON()).toEqual(before);
  });

  test('clamps a stale insert position to the current document', async () => {
    mockFetch(
      Response.json(
        { filename: 'x.png', url: '/.issues/assets/x.png' },
        { status: 201 },
      ),
    );
    const editor = makeEditor('Hello');
    expect(await uploadImage(editor.view, png(), { insertPos: 9999 })).toBe(
      true,
    );
    expect(getEditorMarkdown(editor)).toContain('/.issues/assets/x.png');
  });
});
