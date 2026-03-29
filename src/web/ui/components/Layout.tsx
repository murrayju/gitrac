import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useGitStatus } from '../hooks.ts';
import { BranchWarning } from './BranchWarning.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { gitStatus } = useGitStatus();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col border-r border-gray-800 bg-gray-950">
        <div className="px-4 py-5">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            gitrac
          </Link>
        </div>

        <nav className="flex-1 px-2 space-y-0.5">
          <NavLink to="/" active={location.pathname === '/'}>
            Issues
          </NavLink>
          <NavLink
            to="/new"
            active={location.pathname === '/new'}
          >
            + New Issue
          </NavLink>
        </nav>

        <div className="px-4 py-3 border-t border-gray-800">
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
}: {
  to: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`block px-3 py-1.5 rounded text-sm ${
        active
          ? 'bg-gray-800 text-gray-100'
          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-900'
      }`}
    >
      {children}
    </Link>
  );
}
