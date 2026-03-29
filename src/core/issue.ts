import matter from 'gray-matter';
import { parseComments, serializeComments } from './comments.ts';
import type { Issue, IssueFrontmatter } from './types.ts';

/**
 * Parse a markdown issue file into an Issue object.
 *
 * File format:
 * 1. YAML frontmatter between `---` markers
 * 2. Description (supports full markdown including headings)
 * 3. `---` separator (only present if there are comments)
 * 4. Comments section
 */
export function parseIssue(markdown: string): Issue {
  const { data, content } = matter(markdown);
  const fm = data as IssueFrontmatter;

  // Split content into description and comments.
  // The separator is a `---` on its own line, but we need to be careful:
  // gray-matter already strips the frontmatter, so `content` starts after the closing ---.
  // We look for a --- line that separates description from comments.
  const { description, commentsSection } = splitContent(content);

  const comments = commentsSection ? parseComments(commentsSection) : [];

  return {
    id: fm.id,
    title: fm.title,
    status: fm.status,
    priority: fm.priority,
    assignee: fm.assignee ?? '',
    labels: fm.labels ?? [],
    created: fm.created,
    createdBy: fm.createdBy,
    updated: fm.updated,
    description,
    comments,
  };
}

/**
 * Serialize an Issue object back to a markdown file string.
 */
export function serializeIssue(issue: Issue): string {
  const frontmatter: IssueFrontmatter = {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    assignee: issue.assignee,
    labels: issue.labels,
    created: issue.created,
    createdBy: issue.createdBy,
    updated: issue.updated,
  };

  let body = issue.description;

  if (issue.comments.length > 0) {
    const commentStr = serializeComments(issue.comments);
    body = `${body}\n\n---\n\n${commentStr}`;
  }

  // gray-matter stringify adds the frontmatter delimiters
  const result = matter.stringify(`\n${body}\n`, frontmatter);
  return result;
}

/**
 * Split the content (after frontmatter) into description and comments section.
 * The separator is a `---` on its own line.
 */
function splitContent(content: string): {
  description: string;
  commentsSection: string;
} {
  // Find --- separator that's on its own line (not inside code fences)
  const lines = content.split('\n');
  let inCodeFence = false;
  let separatorIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (line.startsWith('```')) {
      inCodeFence = !inCodeFence;
    } else if (!inCodeFence && line === '---') {
      separatorIndex = i;
      break;
    }
  }

  if (separatorIndex === -1) {
    // No separator — everything is description, no comments
    return {
      description: content.trim(),
      commentsSection: '',
    };
  }

  const descriptionLines = lines.slice(0, separatorIndex);
  const commentLines = lines.slice(separatorIndex + 1);

  return {
    description: descriptionLines.join('\n').trim(),
    commentsSection: commentLines.join('\n').trim(),
  };
}
