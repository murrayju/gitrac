import simpleGit from 'simple-git';
import type { ClaimUser } from '../core/claim.ts';

/** Name used when git has no `user.name` configured (matches the CLI). */
export const UNKNOWN_AUTHOR = 'unknown';

/**
 * Read the git identity (`user.name` / `user.email`) as seen from `dir`
 * (so repo-local config overrides global). Falls back to `unknown` / '' like
 * the CLI when unset or when git can't be run.
 */
export async function readGitIdentity(dir: string): Promise<ClaimUser> {
  try {
    const git = simpleGit(dir);
    const [name, email] = await Promise.all([
      git.getConfig('user.name'),
      git.getConfig('user.email'),
    ]);
    return {
      name: name.value?.trim() || UNKNOWN_AUTHOR,
      email: email.value?.trim() || '',
    };
  } catch {
    return { name: UNKNOWN_AUTHOR, email: '' };
  }
}

export interface IdentityResolverOptions {
  /**
   * Fixed author name (e.g. from `--author`). When set, git config is never
   * consulted and the email is ''. Mirrors `resolveClaimUser` in the CLI.
   */
  author?: string;
  /**
   * How long a resolved identity is reused before git config is re-read
   * (default 5s). `0` re-reads on every `get()`.
   */
  maxAgeMs?: number;
  /** Identity source; defaults to `readGitIdentity`. For tests. */
  read?: (dir: string) => Promise<ClaimUser>;
  /** Clock; for tests. */
  now?: () => number;
}

const DEFAULT_MAX_AGE_MS = 5000;

/**
 * The web server's default identity (who `createdBy` and comment authors are
 * attributed to when the browser doesn't pick someone).
 *
 * Resolved from git config at startup (`refresh()`), then re-read lazily at
 * most every `maxAgeMs` so `git config user.name ...` changes are picked up
 * without restarting the server. Concurrent refreshes share one lookup.
 */
export class IdentityResolver {
  private readonly dir: string;
  private readonly author: string;
  private readonly maxAgeMs: number;
  private readonly read: (dir: string) => Promise<ClaimUser>;
  private readonly now: () => number;
  private cached: ClaimUser | null = null;
  private resolvedAt = 0;
  private inflight: Promise<ClaimUser> | null = null;

  constructor(dir: string, options: IdentityResolverOptions = {}) {
    this.dir = dir;
    this.author = options.author?.trim() ?? '';
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.read = options.read ?? readGitIdentity;
    this.now = options.now ?? Date.now;
  }

  /** The current identity, re-reading git config if the cache is stale. */
  async get(): Promise<ClaimUser> {
    if (this.author) return { name: this.author, email: '' };
    if (this.cached && this.now() - this.resolvedAt < this.maxAgeMs) {
      return this.cached;
    }
    return this.refresh();
  }

  /** Re-read git config now (also used to prime the cache at startup). */
  refresh(): Promise<ClaimUser> {
    if (this.author) return Promise.resolve({ name: this.author, email: '' });
    if (!this.inflight) {
      this.inflight = this.read(this.dir)
        .then((user) => {
          this.cached = user;
          this.resolvedAt = this.now();
          return user;
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    return this.inflight;
  }
}
