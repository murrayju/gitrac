import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import type { Config } from '../core/types.ts';
import { AmendTracker } from '../git/amend-tracker.ts';
import { getBranchWarning } from '../git/status.ts';
import { assetRoutes, MAX_UPLOAD_BYTES, serveAsset } from './routes/assets.ts';
import { configRoutes } from './routes/config.ts';
import { draftRoutes } from './routes/drafts.ts';
import { eventsRoute } from './routes/events.ts';
import { gitRoutes } from './routes/git.ts';
import { issueRoutes } from './routes/issues.ts';
import {
  DEFAULT_HOST,
  isLoopbackHost,
  isWildcardHost,
  requestGuard,
} from './security.ts';
import { IssueWatcher } from './watcher.ts';

export interface ServerContext {
  dir: string;
  config: Config;
  amendTracker: AmendTracker;
  watcher: IssueWatcher;
}

export interface AppOptions {
  /**
   * Interface the server is bound to (default: 127.0.0.1). Used to decide
   * which `Host` headers are accepted; see `requestGuard`.
   */
  host?: string;
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
}): Promise<RunningServer> {
  const { dir, config } = options;
  const port = options.port ?? 3000;
  const host = options.host ?? DEFAULT_HOST;

  const amendTracker = new AmendTracker();
  const watcher = new IssueWatcher(dir);

  const ctx: ServerContext = { dir, config, amendTracker, watcher };

  const app = createApp(ctx, { host });

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

  console.log(
    `\n  gitrac server running at ${displayUrl(host, server.port)}\n`,
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

/** Locate the built UI assets directory, checking several candidate paths. */
function findUiDistDir(projectDir: string): string | null {
  const candidates = [
    // Relative to executable (compiled binary)
    resolve(dirname(process.execPath), 'dist', 'ui'),
    // Relative to project working directory
    resolve(projectDir, 'dist', 'ui'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) {
      return dir;
    }
  }
  return null;
}

export function createApp(ctx: ServerContext, options: AppOptions = {}): Hono {
  const app = new Hono();

  // No CORS: the UI is same-origin, and the Vite dev server proxies /api
  // (preserving Host, so Origin and Host still match). Reject foreign Hosts
  // (DNS rebinding) and cross-origin mutations (CSRF).
  app.use('*', requestGuard(options.host ?? DEFAULT_HOST));

  // API routes
  app.route('/api', issueRoutes(ctx));
  app.route('/api', draftRoutes(ctx));
  app.route('/api', assetRoutes(ctx));
  app.route('/api', configRoutes(ctx));
  app.route('/api', gitRoutes(ctx));
  app.route('/api', eventsRoute(ctx));

  // Serve issue assets at their repo path (/.issues/assets/:filename)
  // so markdown image URLs work in both the web UI and on GitHub.
  app.get('/.issues/assets/:filename', serveAsset(ctx));

  // Static file serving for built UI assets.
  // Try multiple locations: relative to executable (compiled binary), then cwd.
  const distDir = findUiDistDir(ctx.dir);
  if (distDir) {
    app.use(
      '/*',
      serveStatic({
        root: distDir,
        rewriteRequestPath: (path) => path,
      }),
    );

    // SPA fallback: serve index.html for non-API routes
    app.get('*', async (c) => {
      const indexPath = join(distDir, 'index.html');
      if (existsSync(indexPath)) {
        return c.html(await Bun.file(indexPath).text());
      }
      return c.text('Not Found', 404);
    });
  }

  return app;
}
