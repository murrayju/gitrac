import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import type { Config } from '../core/types.ts';
import { AmendTracker } from '../git/amend-tracker.ts';
import { getBranchWarning } from '../git/status.ts';
import { assetRoutes } from './routes/assets.ts';
import { configRoutes } from './routes/config.ts';
import { eventsRoute } from './routes/events.ts';
import { gitRoutes } from './routes/git.ts';
import { issueRoutes } from './routes/issues.ts';
import { IssueWatcher } from './watcher.ts';

export interface ServerContext {
  dir: string;
  config: Config;
  amendTracker: AmendTracker;
  watcher: IssueWatcher;
}

export async function startServer(options: {
  dir: string;
  port?: number;
  config: Config;
}): Promise<void> {
  const { dir, config } = options;
  const port = options.port ?? 3000;

  const amendTracker = new AmendTracker();
  const watcher = new IssueWatcher(dir);

  const ctx: ServerContext = { dir, config, amendTracker, watcher };

  const app = createApp(ctx);

  // Start file watcher
  watcher.start();

  // Print branch warning if applicable
  const warning = await getBranchWarning(dir, config);
  if (warning) {
    console.warn(`\n  Warning: ${warning}\n`);
  }

  console.log(`\n  gitrac server running at http://localhost:${port}\n`);

  Bun.serve({
    port,
    fetch: app.fetch,
  });
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

export function createApp(ctx: ServerContext): Hono {
  const app = new Hono();

  // CORS for Vite dev proxy
  app.use('*', cors());

  // API routes
  app.route('/api', issueRoutes(ctx));
  app.route('/api', assetRoutes(ctx));
  app.route('/api', configRoutes(ctx));
  app.route('/api', gitRoutes(ctx));
  app.route('/api', eventsRoute(ctx));

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
    app.get('*', (c) => {
      const indexPath = join(distDir, 'index.html');
      if (existsSync(indexPath)) {
        return c.html(Bun.file(indexPath) as unknown as string);
      }
      return c.text('Not Found', 404);
    });
  }

  return app;
}
