import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useState } from 'react';
import { Markdown } from 'tiptap-markdown';
import { addComment } from '../api.ts';

export function CommentEditor({ issueId }: { issueId: number }) {
  const [submitting, setSubmitting] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Add a comment...' }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class:
          'prose prose-invert prose-sm max-w-none px-4 py-3 min-h-[80px] focus:outline-none',
      },
    },
  });

  async function handleSubmit() {
    if (!editor) return;
    // biome-ignore lint/suspicious/noExplicitAny: tiptap-markdown extends storage dynamically
    const md = (editor.storage as any).markdown.getMarkdown() as string;
    if (!md.trim()) return;

    setSubmitting(true);
    try {
      await addComment(issueId, md);
      editor.commands.clearContent();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="rounded border border-gray-800 bg-gray-900/50">
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
