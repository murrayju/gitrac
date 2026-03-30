import type { Editor } from '@tiptap/core';

/**
 * Get markdown from a Tiptap editor, with post-processing to fix
 * block image whitespace (tiptap-markdown doesn't add blank lines
 * around block images).
 */
export function getEditorMarkdown(editor: Editor): string {
  // biome-ignore lint/suspicious/noExplicitAny: tiptap-markdown extends storage dynamically
  const raw = (editor.storage as any).markdown.getMarkdown() as string;
  return normalizeImageWhitespace(raw);
}

/**
 * Ensure block-level images have blank lines before and after them.
 * A block-level image is one that occupies an entire line on its own.
 */
export function normalizeImageWhitespace(markdown: string): string {
  // Match lines that are solely an image (with optional whitespace)
  // Ensure there's a blank line before and after each image line
  return markdown
    .replace(/([^\n])\n(!\[)/g, '$1\n\n$2') // ensure blank line before image
    .replace(/(!\[[^\]]*\]\([^)]*\))\n([^\n])/g, '$1\n\n$2') // ensure blank line after image
    .replace(/\n{3,}/g, '\n\n'); // collapse 3+ newlines to 2
}
