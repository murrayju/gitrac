import { Extension } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Markdown } from 'tiptap-markdown';
import type { Comment } from '../../../core/types.ts';
import { deleteComment, updateComment } from '../api.ts';
import { ImageUpload } from '../lib/image-upload-plugin.ts';
import { getEditorMarkdown } from '../lib/markdown.ts';
import { relativeTime } from '../lib/time.ts';
import { MarkdownContent } from './MarkdownContent.tsx';

const AVATAR_COLORS = [
  'bg-blue-600',
  'bg-green-600',
  'bg-amber-600',
  'bg-red-600',
  'bg-purple-600',
  'bg-pink-600',
  'bg-teal-600',
  'bg-indigo-600',
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? 'bg-gray-600';
}

function CommentMenu({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
        title="Comment actions"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="w-4 h-4"
          role="img"
          aria-label="Comment actions"
        >
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 min-w-28 rounded border border-gray-200 bg-white shadow-lg py-1 dark:border-gray-700 dark:bg-gray-900">
          <button
            type="button"
            onClick={() => {
              onEdit();
              setOpen(false);
            }}
            className="block w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              onDelete();
              setOpen(false);
            }}
            className="block w-full text-left px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function InlineCommentEditor({
  initialBody,
  onSave,
  onCancel,
}: {
  initialBody: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const saveRef = useRef<() => void>(null);

  const SubmitShortcut = Extension.create({
    name: 'submitShortcut',
    addKeyboardShortcuts() {
      return {
        'Mod-Enter': () => {
          saveRef.current?.();
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
      Placeholder.configure({ placeholder: 'Edit comment...' }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      SubmitShortcut,
    ],
    content: initialBody,
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none px-4 py-3 min-h-[80px] focus:outline-none dark:prose-invert',
      },
    },
  });

  const handleSave = useCallback(async () => {
    if (!editor) return;
    const md = getEditorMarkdown(editor);
    if (!md.trim()) return;
    setSaving(true);
    try {
      onSave(md);
    } finally {
      setSaving(false);
    }
  }, [editor, onSave]);

  saveRef.current = handleSave;

  return (
    <div>
      <div className="rounded border border-gray-200 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/50">
        <EditorContent editor={editor} />
      </div>
      <div className="flex gap-2 justify-end mt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function CommentItem({
  comment,
  index,
  issueId,
}: {
  comment: Comment;
  index: number;
  issueId: number;
}) {
  const [editing, setEditing] = useState(false);

  async function handleSave(body: string) {
    await updateComment(issueId, index, body);
    setEditing(false);
  }

  async function handleDelete() {
    if (!window.confirm('Delete this comment?')) return;
    await deleteComment(issueId, index);
  }

  return (
    <div className="group flex gap-3">
      <div
        className={`w-8 h-8 rounded-full ${avatarColor(comment.author)} flex items-center justify-center text-xs font-medium text-white shrink-0`}
      >
        {comment.author.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {comment.author}
          </span>
          <span
            className="text-xs text-gray-500"
            title={new Date(comment.timestamp).toLocaleString()}
          >
            {relativeTime(comment.timestamp)}
          </span>
          <div className="ml-auto">
            <CommentMenu
              onEdit={() => setEditing(true)}
              onDelete={handleDelete}
            />
          </div>
        </div>
        {editing ? (
          <InlineCommentEditor
            initialBody={comment.body}
            onSave={handleSave}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <MarkdownContent content={comment.body} />
        )}
      </div>
    </div>
  );
}

export function CommentList({
  comments,
  issueId,
}: {
  comments: Comment[];
  issueId: number;
}) {
  if (comments.length === 0) {
    return <div className="text-gray-500 text-sm py-4">No comments yet.</div>;
  }

  return (
    <div className="space-y-4">
      {comments.map((comment, index) => (
        <CommentItem
          key={`${comment.author}-${comment.timestamp}`}
          comment={comment}
          index={index}
          issueId={issueId}
        />
      ))}
    </div>
  );
}
