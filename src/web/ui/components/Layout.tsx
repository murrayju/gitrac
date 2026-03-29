import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useGitStatus } from '../hooks.ts';
import { BranchWarning } from './BranchWarning.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { gitStatus } = useGitStatus();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile sidebar toggle */}
      <button
        type="button"
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? '✕' : '☰'}
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
          <NavLink
            to="/new"
            active={location.pathname === '/new'}
            onClick={() => setSidebarOpen(false)}
          >
            + New Issue
          </NavLink>
        </nav>

        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800">
          <ThemeToggle />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {gitStatus && !gitStatus.isDefaultBranch && (
          <BranchWarning
            branch={gitStatus.branch}
            defaultBranch={gitStatus.defaultBranch}
          />
        )}
        <div className="flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}

function NavLink({
  to,
  active,
  children,
  onClick,
}: {
  to: string;
  active: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`block px-3 py-1.5 rounded text-sm ${
        active
          ? 'bg-gray-200 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
          : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-900'
      }`}
    >
      {children}
    </Link>
  );
}
