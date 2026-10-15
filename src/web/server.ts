import type { Context } from 'hono';
import { Hono } from 'hono';
import { getMimeType } from 'hono/utils/mime';
import type { Config } from '../core/types.ts';
import { AmendTracker } from '../git/amend-tracker.ts';
import { IdentityResolver } from '../git/identity.ts';
import { getBranchWarning } from '../git/status.ts';
import { freshConfig } from './live-config.ts';
import { assetRoutes, MAX_UPLOAD_BYTES, serveAsset } from './routes/assets.ts';
import { configRoutes } from './routes/config.ts';
import { draftRoutes } from './routes/drafts.ts';
import { eventsRoute } from './routes/events.ts';
import { gitRoutes } from './routes/git.ts';
import { identityRoutes } from './routes/identity.ts';
import { issueRoutes } from './routes/issues.ts';
import {
  DEFAULT_HOST,
  isLoopbackHost,
  isWildcardHost,
  requestGuard,
} from './security.ts';
import { resolveUiAssets, type UiAssets } from './ui-assets.ts';
import { IssueWatcher } from './watcher.ts';

export interface ServerContext {
  dir: string;
  /**
   * Project config. Not a startup snapshot: re-read from disk before every
   * read-only API request (`freshConfig`) and, for mutations, after the repo
   * lock is acquired (`mutationLock`), so CLI edits are picked up live.
   */
  config: Config;
  amendTracker: AmendTracker;
  watcher: IssueWatcher;
  /**
   * Default identity for `createdBy` / comment authors (git config, or
   * `--author`). Created lazily from `dir` if omitted.
   */
  identity?: IdentityResolver;
}

export interface AppOptions {
  /**
   * Interface the server is bound to (default: 127.0.0.1). Used to decide
   * which `Host` headers are accepted; see `requestGuard`.
   */
  host?: string;
  /**
   * Built UI to serve. Default: `resolveUiAssets()` — embedded in a compiled
   * binary, else gitrac's own source-tree dist/ui. `null` = API only.
   */
  ui?: UiAssets | null;
}

export interface RunningServer {
  /** Address actually bound (e.g. `127.0.0.1`). */
  hostname: string;
  /** Port actually bound (useful with `port: 0`). */
  port: number;
  /** Stop the HTTP server and the file watcher. */
  stop(): Promise<void>;
}

/** Hard cap on any request body (uploads are limited separately, below this). */
const MAX_REQUEST_BODY_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

export async function startServer(options: {
  dir: string;
  port?: number;
  host?: string;
  config: Config;
  /** Fixed default author name (`--author`); otherwise git config is used. */
  author?: string;
}): Promise<RunningServer> {
  const { dir, config } = options;
  const port = options.port ?? 3000;
  const host = options.host ?? DEFAULT_HOST;

  const amendTracker = new AmendTracker();
  const watcher = new IssueWatcher(dir);

  const identity = new IdentityResolver(dir, { author: options.author });
  await identity.refresh();

  const ctx: ServerContext = { dir, config, amendTracker, watcher, identity };

  const ui = resolveUiAssets();
  const app = createApp(ctx, { host, ui });

  // Bind before starting the watcher so a bad --host / busy port fails fast.
  const server = Bun.serve({
    hostname: host,
    port,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    fetch: app.fetch,
  });

  // Start file watcher
  watcher.start();

  // Print branch warning if applicable
  const warning = await getBranchWarning(dir, config);
  if (warning) {
    console.warn(`\n  Warning: ${warning}\n`);
  }

  if (!ui) {
    console.warn(
      '\n  Warning: web UI not built — only the API is served. Run ' +
        '`./bun run vite build --config vite.config.ts` (or use the Vite dev ' +
        'server).',
    );
  }

  console.log(
    `\n  gitrac server running at ${displayUrl(host, server.port)}\n`,
  );
  const who = await identity.get();
  console.log(
    `  Attributing web changes to ${who.name}${who.email ? ` <${who.email}>` : ''}\n`,
  );
  if (!isLoopbackHost(host)) {
    console.warn(
      `  Warning: listening on ${isWildcardHost(host) ? 'all interfaces' : host}. ` +
        'gitrac has no authentication — anyone who can reach this address can ' +
        'read and modify issues and create commits.\n',
    );
  }

  return {
    hostname: server.hostname ?? host,
    port: server.port ?? port,
    async stop() {
      watcher.stop();
      await server.stop(true);
    },
  };
}

/** URL to print on startup for the given bind host. */
export function displayUrl(host: string, port: number | undefined): string {
  let name = host;
  if (isWildcardHost(host) || host === DEFAULT_HOST) {
    name = 'localhost';
  } else if (host.includes(':') && !host.startsWith('[')) {
    name = `[${host}]`;
  }
  return `http://${name}:${port}`;
}

/** Hashed Vite build output: safe to cache forever. */
const IMMUTABLE_PREFIX = '/assets/';

/**
 * Serve the built UI: the file at the request path, else (SPA routing)
 * index.html. Missing hashed `/assets/*` files are a 404, not HTML.
 */
function serveUi(ui: UiAssets) {
  return async (c: Context): Promise<Response> => {
    const path = c.req.path === '/' ? '/index.html' : c.req.path;
    const file = await ui.get(path);
    if (file) {
      const immutable = path.startsWith(IMMUTABLE_PREFIX);
      return new Response(file, {
        headers: {
          'content-type':
            getMimeType(path) ?? (file.type || 'application/octet-stream'),
          'cache-control': immutable
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        },
      });
    }
    if (path.startsWith(IMMUTABLE_PREFIX)) {
      return c.text('Not Found', 404);
    }
    const index = await ui.get('/index.html');
    if (!index) return c.text('Not Found', 404);
    return new Response(index, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache',
      },
    });
  };
}

export function createApp(ctx: ServerContext, options: AppOptions = {}): Hono {
  const app = new Hono();

  // No CORS: the UI is same-origin, and the Vite dev server proxies /api
  // (preserving Host, so Origin and Host still match). Reject foreign Hosts
  // (DNS rebinding) and cross-origin mutations (CSRF).
  app.use('*', requestGuard(options.host ?? DEFAULT_HOST));

  // config.yaml may be changed by the CLI at any time; never serve a stale copy.
  app.use('/api/*', freshConfig(ctx));

  // API routes
  app.route('/api', issueRoutes(ctx));
  app.route('/api', draftRoutes(ctx));
  app.route('/api', assetRoutes(ctx));
  app.route('/api', configRoutes(ctx));
  app.route('/api', gitRoutes(ctx));
  app.route('/api', identityRoutes(ctx));
  app.route('/api', eventsRoute(ctx));

  // Serve issue assets at their repo path (/.issues/assets/:filename)
  // so markdown image URLs work in both the web UI and on GitHub.
  app.get('/.issues/assets/:filename', serveAsset(ctx));

  // Built UI: embedded in the binary, or gitrac's own dist/ui from source.
  // Never looked up in the served project (it may have an unrelated dist/ui).
  const ui = options.ui === undefined ? resolveUiAssets() : options.ui;
  if (ui) {
    app.get('*', serveUi(ui));
  }

  return app;
}
