import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect, useRef } from 'react';
import { Markdown } from 'tiptap-markdown';

export function IssueEditor({
  content,
  onChange,
  placeholder = 'Describe the issue...',
  editable = true,
}: {
  content: string;
  onChange?: (markdown: string) => void;
  placeholder?: string;
  editable?: boolean;
}) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleUpdate = useCallback(
    ({ editor }: { editor: { storage: { markdown: { getMarkdown: () => string } } } }) => {
      if (!onChangeRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const md = editor.storage.markdown.getMarkdown() as string;
        onChangeRef.current?.(md);
      }, 500);
    },
    [],
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
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
          'prose prose-invert prose-sm max-w-none px-4 py-3 min-h-[120px] focus:outline-none',
      },
    },
  });

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

  return (
    <div className="rounded border border-gray-800 bg-gray-900/50">
      <EditorContent editor={editor} />
    </div>
  );
}
