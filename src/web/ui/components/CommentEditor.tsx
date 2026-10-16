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
import { trackRequest } from '../lib/request-state.ts';
import { tableExtensions } from '../lib/table-extensions.ts';
import { useIssueLinks } from '../lib/use-issue-links.ts';
import { useIdentityStore } from '../stores/identityStore.ts';
import { UploadError, useUploadError } from './UploadError.tsx';

export function CommentEditor({ issueId }: { issueId: number }) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitRef = useRef<() => void>(null);
  const author = useIdentityStore((s) => s.author);

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

  const issueLinks = useIssueLinks({ inApp: false });
  const uploadError = useUploadError();
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: false }),
      ...tableExtensions,
      ImageUpload.configure(uploadError.handlers),
      Placeholder.configure({ placeholder: 'Add a comment...' }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      SubmitShortcut,
      issueLinks,
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
    if (!md.trim() || submitting) return;

    // On a failure, keep the draft and show why
    await trackRequest(
      async () => {
        await addComment(issueId, md, author || undefined);
        editor.commands.clearContent();
      },
      { setBusy: setSubmitting, setError: setSubmitError },
    );
  }, [editor, issueId, author, submitting]);

  submitRef.current = handleSubmit;

  return (
    <div>
      <div className="rounded border border-gray-200 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/50">
        <EditorContent editor={editor} />
      </div>
      <UploadError error={uploadError.error} onDismiss={uploadError.dismiss} />
      {submitError && (
        <div role="alert" className="mt-2 text-sm text-red-500">
          Failed to post comment: {submitError}
        </div>
      )}
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
