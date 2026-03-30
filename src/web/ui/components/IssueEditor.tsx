import type { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { Markdown } from 'tiptap-markdown';
import { ImageUpload } from '../lib/image-upload-plugin.ts';
import { getEditorMarkdown } from '../lib/markdown.ts';

export interface IssueEditorHandle {
  insertImage: (url: string, alt: string) => void;
}

export const IssueEditor = forwardRef<
  IssueEditorHandle,
  {
    content: string;
    onChange?: (markdown: string) => void;
    placeholder?: string;
    editable?: boolean;
    borderless?: boolean;
  }
>(function IssueEditor(
  {
    content,
    onChange,
    placeholder = 'Describe the issue...',
    editable = true,
    borderless = false,
  },
  ref,
) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleUpdate = useCallback(({ editor }: { editor: Editor }) => {
    if (!onChangeRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const md = getEditorMarkdown(editor);
      onChangeRef.current?.(md);
    }, 500);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: false }),
      ImageUpload,
      Placeholder.configure({ placeholder }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content,
    editable,
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none px-4 py-3 min-h-[120px] focus:outline-none dark:prose-invert',
      },
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      insertImage(url: string, alt: string) {
        if (editor) {
          editor.chain().focus().setImage({ src: url, alt }).run();
        }
      },
    }),
    [editor],
  );

  // Update editable state
  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const wrapperClasses = borderless
    ? ''
    : 'rounded border border-gray-200 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/50';

  return (
    <div className={wrapperClasses}>
      <EditorContent editor={editor} />
    </div>
  );
});
