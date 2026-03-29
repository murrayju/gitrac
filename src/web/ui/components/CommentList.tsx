import type { Comment } from '../../../core/types.ts';
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

export function CommentList({ comments }: { comments: Comment[] }) {
  if (comments.length === 0) {
    return <div className="text-gray-500 text-sm py-4">No comments yet.</div>;
  }

  return (
    <div className="space-y-4">
      {comments.map((comment) => (
        <div
          key={`${comment.author}-${comment.timestamp}`}
          className="flex gap-3"
        >
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
            </div>
            <MarkdownContent content={comment.body} />
          </div>
        </div>
      ))}
    </div>
  );
}
