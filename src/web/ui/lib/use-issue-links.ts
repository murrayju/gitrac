import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IssueLinks } from './issue-link-plugin.ts';

/**
 * The `IssueLinks` editor extension for a component, configured once (an
 * editor reads its extensions only when created). With `inApp`, clicking a
 * `#N` reference navigates client-side; otherwise it opens a new tab (for
 * composers, so navigating doesn't drop the text being written).
 */
export function useIssueLinks({ inApp }: { inApp: boolean }) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [extension] = useState(() =>
    IssueLinks.configure({
      navigate: inApp ? (path) => navigateRef.current(path) : null,
    }),
  );
  return extension;
}
