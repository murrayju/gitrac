import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

// ============================================================================
// Built web UI assets (the Vite output in dist/ui/).
//
// Two sources, in order of preference:
//   1. Embedded: the compiled binary's generated entry (scripts/build.ts)
//      imports every dist/ui file `with { type: 'file' }`, which embeds it in
//      the executable, and registers the URL-path -> embedded-path manifest
//      via `registerEmbeddedUi` before the CLI runs.
//   2. Source tree: running from source (`./gitrac`), serve the dist/ui built
//      by Vite next to *this source file* — never relative to the project
//      being served or the bun executable, which may hold an unrelated UI.
// ============================================================================

/** A read-only set of UI files addressed by URL path (e.g. `/index.html`). */
export interface UiAssets {
  /** Where the files come from, for diagnostics. */
  readonly source: string;
  /** The file for a URL path, or null if there is none. */
  get(urlPath: string): Promise<Blob | null>;
}

/** gitrac's own dist/ui, resolved from the source tree (not cwd / project). */
export const SOURCE_UI_DIST_DIR = resolve(
  import.meta.dir,
  '..',
  '..',
  'dist',
  'ui',
);

/**
 * True inside a `bun build --compile` executable, whose modules live in a
 * virtual filesystem (`/$bunfs/...`, `B:\\~BUN\\...` on Windows) — there is
 * no source tree to find dist/ui in.
 */
export function isCompiledBinary(moduleDir: string = import.meta.dir): boolean {
  return moduleDir.includes('$bunfs') || moduleDir.includes('~BUN');
}

let embedded: UiAssets | null = null;

/**
 * Register the UI files embedded in a compiled binary. `files` maps URL paths
 * (`/index.html`, `/assets/index-abc123.js`) to the paths returned by
 * `import ... with { type: 'file' }`. Called by the generated build entry.
 */
export function registerEmbeddedUi(files: Record<string, string>): void {
  embedded = embeddedUiAssets(files);
}

/** Forget the registered embedded UI (tests). */
export function clearEmbeddedUi(): void {
  embedded = null;
}

/** UI assets served from an in-binary (or any fixed) file manifest. */
export function embeddedUiAssets(files: Record<string, string>): UiAssets {
  const manifest = new Map(Object.entries(files));
  return {
    source: 'embedded',
    async get(urlPath) {
      const path = manifest.get(urlPath);
      return path === undefined ? null : Bun.file(path);
    },
  };
}

/** UI assets read from a directory on disk (dev: a Vite `dist/ui`). */
export function directoryUiAssets(root: string): UiAssets {
  const base = resolve(root);
  return {
    source: base,
    async get(urlPath) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(urlPath);
      } catch {
        return null;
      }
      if (decoded.includes('\0')) return null;
      const full = resolve(
        base,
        `.${decoded.startsWith('/') ? '' : '/'}${decoded}`,
      );
      const rel = relative(base, full);
      // Stay inside the dist dir (no `..` / absolute escapes).
      if (
        !rel ||
        rel.startsWith(`..${sep}`) ||
        rel === '..' ||
        isAbsolute(rel)
      ) {
        return null;
      }
      const file = Bun.file(full);
      try {
        const stat = await file.stat();
        return stat.isFile() ? file : null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * The UI to serve: the embedded one in a compiled binary, else (running from
 * source) gitrac's own built dist/ui if present, else null (API only — e.g.
 * using the Vite dev server, or the UI hasn't been built).
 */
export function resolveUiAssets(): UiAssets | null {
  if (embedded) return embedded;
  if (
    !isCompiledBinary() &&
    existsSync(resolve(SOURCE_UI_DIST_DIR, 'index.html'))
  ) {
    return directoryUiAssets(SOURCE_UI_DIST_DIR);
  }
  return null;
}
