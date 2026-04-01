import { Extension } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useRef, useState } from 'react';
import { Markdown } from 'tiptap-markdown';
import { addComment } from '../api.ts';
import { ImageUpload } from '../lib/image-upload-plugin.ts';
import { getEditorMarkdown } from '../lib/markdown.ts';

export function CommentEditor({ issueId }: { issueId: number }) {
  const [submitting, setSubmitting] = useState(false);
  const submitRef = useRef<() => void>(null);

  const SubmitShortcut = Extension.create({
    name: 'submitShortcut',
    addKeyboardShortcuts() {
      return {
        'Mod-Enter': () => {
          submitRef.current?.();
          return true;
        },
      };
    },
  });

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: false }),
      ImageUpload,
      Placeholder.configure({ placeholder: 'Add a comment...' }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      SubmitShortcut,
    ],
    content: '',
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none px-4 py-3 min-h-[80px] focus:outline-none dark:prose-invert',
      },
    },
  });

  const handleSubmit = useCallback(async () => {
    if (!editor) return;
    const md = getEditorMarkdown(editor);
    if (!md.trim()) return;

    setSubmitting(true);
    try {
      await addComment(issueId, md);
      editor.commands.clearContent();
    } finally {
      setSubmitting(false);
    }
  }, [editor, issueId]);

  submitRef.current = handleSubmit;

  return (
    <div>
      <div className="rounded border border-gray-200 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/50">
        <EditorContent editor={editor} />
      </div>
      <div className="flex justify-end mt-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Posting...' : 'Comment'}
        </button>
      </div>
    </div>
  );
}
