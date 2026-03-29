/// <reference types="vite/client" />

declare module '*.css' {
  const content: string;
  export default content;
}

declare module 'tiptap-markdown' {
  import type { Extension } from '@tiptap/core';
  export const Markdown: Extension;
}
