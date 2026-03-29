import { Hono } from 'hono';
import {
  getCurrentBranch,
  hasRemote,
  isOnDefaultBranch,
  isPushed,
} from '../../git/status.ts';
import type { ServerContext } from '../server.ts';

export function gitRoutes(ctx: ServerContext): Hono {
  const app = new Hono();

  app.get('/git/status', async (c) => {
    const { dir, config } = ctx;

    const [branch, isDefault, remote, pushed] = await Promise.all([
      getCurrentBranch(dir),
      isOnDefaultBranch(dir, config),
      hasRemote(dir),
      isPushed(dir),
    ]);

    return c.json({
      branch,
      defaultBranch: config.git.defaultBranch,
      isDefaultBranch: isDefault,
      hasUnpushedCommits: !pushed,
      hasRemote: remote,
    });
  });

  return app;
}
