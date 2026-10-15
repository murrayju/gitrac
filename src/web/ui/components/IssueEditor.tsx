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
import { ImageUpload, uploadImage } from '../lib/image-upload-plugin.ts';
import { getEditorMarkdown } from '../lib/markdown.ts';
import { useIssueLinks } from '../lib/use-issue-links.ts';
import { UploadError, useUploadError } from './UploadError.tsx';

export interface IssueEditorHandle {
  insertImage: (url: string, alt: string) => void;
  /**
   * Upload `file` and insert it at the selection; a failure is shown next to
   * the editor (as for pasted/dropped images) and nothing is inserted.
   */
  uploadImage: (file: File) => Promise<void>;
  /**
   * Replace the content with `markdown` without firing `onChange`/`onEdit`,
   * and drop any pending (debounced) `onChange` for the old content.
   */
  setContent: (markdown: string) => void;
  /** Current content serialized as markdown. */
  getMarkdown: () => string;
}

export const IssueEditor = forwardRef<
  IssueEditorHandle,
  {
    /** Initial content (only read at mount; use the handle to replace it). */
    content: string;
    onChange?: (markdown: string) => void;
    /** Called synchronously on every user edit (before the onChange debounce). */
    onEdit?: () => void;
    placeholder?: string;
    editable?: boolean;
    borderless?: boolean;
    /**
     * Clicking a `#N` reference navigates in-app (default: opens a new tab,
     * so a composer doesn't lose its text).
     */
    issueLinksInApp?: boolean;
  }
>(function IssueEditor(
  {
    content,
    onChange,
    onEdit,
    placeholder = 'Describe the issue...',
    editable = true,
    borderless = false,
    issueLinksInApp = false,
  },
  ref,
) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;

  const handleUpdate = useCallback(({ editor }: { editor: Editor }) => {
    onEditRef.current?.();
    if (!onChangeRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const md = getEditorMarkdown(editor);
      onChangeRef.current?.(md);
    }, 500);
  }, []);

  const issueLinks = useIssueLinks({ inApp: issueLinksInApp });
  const uploadError = useUploadError();
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: false }),
      ImageUpload.configure(uploadError.handlers),
      Placeholder.configure({ placeholder }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      issueLinks,
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
      async uploadImage(file: File) {
        if (!editor) return;
        editor.commands.focus();
        await uploadImage(editor.view, file, uploadError.handlers);
      },
      setContent(markdown: string) {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        editor?.commands.setContent(markdown, { emitUpdate: false });
      },
      getMarkdown() {
        return editor ? getEditorMarkdown(editor) : '';
      },
    }),
    [editor, uploadError.handlers],
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
    <div>
      <div className={wrapperClasses}>
        <EditorContent editor={editor} />
      </div>
      <div className={borderless ? 'px-4' : ''}>
        <UploadError
          error={uploadError.error}
          onDismiss={uploadError.dismiss}
        />
      </div>
    </div>
  );
});
