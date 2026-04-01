import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Draft } from '../api.ts';
import { useDrafts, useGitStatus } from '../hooks.ts';
import { BranchWarning } from './BranchWarning.tsx';
import type { CreateIssueModalProps } from './CreateIssueModal.tsx';
import { CreateIssueModal } from './CreateIssueModal.tsx';
import { ImageLightbox } from './ImageLightbox.tsx';
import { ShortcutsModal } from './ShortcutsModal.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';

interface ModalState {
  open: boolean;
  draft?: Draft;
}

interface LayoutContextValue {
  openCreateModal: (draft?: Draft) => void;
  refreshDrafts: () => void;
}

const LayoutContext = createContext<LayoutContextValue>({
  openCreateModal: () => {},
  refreshDrafts: () => {},
});

export function useLayout(): LayoutContextValue {
  return useContext(LayoutContext);
}

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { gitStatus } = useGitStatus();
  const { drafts, refresh: refreshDrafts } = useDrafts();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modal, setModal] = useState<ModalState>({ open: false });
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const openCreateModal = useCallback((draft?: Draft) => {
    setModal({ open: true, draft });
  }, []);

  const handleModalClose: CreateIssueModalProps['onClose'] = (reason) => {
    setModal({ open: false });
    // Refresh drafts count after any close action that might affect drafts
    if (reason === 'submitted' || reason === 'deleted' || reason === 'saved') {
      refreshDrafts();
    }
  };

  // Image lightbox — open on click of any .tiptap img
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG' && target.closest('.tiptap')) {
      e.preventDefault();
      setLightboxSrc((target as HTMLImageElement).src);
    }
  }, []);

  // Global hotkeys
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+/ or Ctrl+/ — toggle shortcuts modal (works even in inputs)
      if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
        return;
      }

      // Ignore remaining shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      )
        return;

      // '?' — toggle shortcuts modal
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
        return;
      }

      // 'c' — open create issue modal
      if (
        e.key === 'c' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !modal.open &&
        !shortcutsOpen
      ) {
        e.preventDefault();
        openCreateModal();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [modal.open, shortcutsOpen, openCreateModal]);

  return (
    <LayoutContext.Provider value={{ openCreateModal, refreshDrafts }}>
      <div className="flex h-screen overflow-hidden">
        {/* Mobile sidebar toggle */}
        <button
          type="button"
          className="md:hidden fixed top-3 left-3 z-50 p-2 rounded bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? '\u2715' : '\u2630'}
        </button>

        {/* Sidebar overlay for mobile */}
        {sidebarOpen && (
          <button
            type="button"
            className="md:hidden fixed inset-0 bg-black/50 z-30"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          />
        )}

        {/* Sidebar */}
        <aside
          className={`fixed md:static z-40 w-56 shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 h-full transition-transform md:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="px-4 py-5">
            <Link
              to="/"
              className="text-lg font-semibold tracking-tight"
              onClick={() => setSidebarOpen(false)}
            >
              gitrac
            </Link>
          </div>

          <nav className="flex-1 px-2 space-y-0.5">
            <NavLink
              to="/"
              active={location.pathname === '/'}
              onClick={() => setSidebarOpen(false)}
            >
              Issues
            </NavLink>
            {drafts.length > 0 && (
              <NavLink
                to="/drafts"
                active={location.pathname === '/drafts'}
                onClick={() => setSidebarOpen(false)}
                badge={drafts.length}
              >
                Drafts
              </NavLink>
            )}
            <button
              type="button"
              className="w-full text-left block px-3 py-1.5 rounded text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-900"
              onClick={() => {
                setSidebarOpen(false);
                openCreateModal();
              }}
            >
              + New Issue
            </button>
          </nav>

          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 space-y-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setShortcutsOpen(true)}
              className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <kbd className="inline-flex items-center justify-center w-5 h-5 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-[10px] font-medium">
                ?
              </kbd>
              <span>Shortcuts</span>
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main
          className="flex-1 flex flex-col overflow-hidden"
          onClick={handleContentClick}
          onKeyDown={undefined}
        >
          {gitStatus && !gitStatus.isDefaultBranch && (
            <BranchWarning
              branch={gitStatus.branch}
              defaultBranch={gitStatus.defaultBranch}
            />
          )}
          <div className="flex-1 overflow-auto">{children}</div>
        </main>

        {/* Create Issue Modal */}
        {modal.open && (
          <CreateIssueModal
            onClose={handleModalClose}
            initialDraft={modal.draft}
          />
        )}

        {/* Keyboard Shortcuts Modal */}
        {shortcutsOpen && (
          <ShortcutsModal onClose={() => setShortcutsOpen(false)} />
        )}

        {/* Image Lightbox */}
        {lightboxSrc && (
          <ImageLightbox
            src={lightboxSrc}
            onClose={() => setLightboxSrc(null)}
          />
        )}
      </div>
    </LayoutContext.Provider>
  );
}

function NavLink({
  to,
  active,
  children,
  onClick,
  badge,
}: {
  to: string;
  active: boolean;
  children?: ReactNode;
  onClick?: () => void;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`flex items-center justify-between px-3 py-1.5 rounded text-sm ${
        active
          ? 'bg-gray-200 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
          : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-900'
      }`}
    >
      <span>{children}</span>
      {badge != null && badge > 0 && (
        <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-gray-300 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
          {badge}
        </span>
      )}
    </Link>
  );
}
