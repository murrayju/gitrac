import Image from '@tiptap/extension-image';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { useIssueLinks } from '../lib/use-issue-links.ts';

export function MarkdownContent({ content }: { content: string }) {
  const issueLinks = useIssueLinks({ inApp: true });
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: false }),
      Markdown.configure({ html: false }),
      issueLinks,
    ],
    content,
    editable: false,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none dark:prose-invert',
      },
    },
  });

  return <EditorContent editor={editor} />;
}
