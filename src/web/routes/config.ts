import { join } from 'node:path';
import { Hono } from 'hono';
import { ensureLabelColors } from '../../core/config.ts';
import { readConfig, writeConfig } from '../../fs/issue-store.ts';
import { commitIssueChange } from '../../git/operations.ts';
import type { ServerContext } from '../server.ts';

export function configRoutes(ctx: ServerContext): Hono {
  const app = new Hono();

  app.get('/config', (c) => {
    return c.json(ctx.config);
  });

  // PATCH /config/labels — update label colors
  app.patch('/config/labels', async (c) => {
    const { dir, config } = ctx;
    const body = await c.req.json();
    const { labelColors } = body;

    if (
      typeof labelColors !== 'object' ||
      labelColors === null ||
      Array.isArray(labelColors)
    ) {
      return c.json({ error: 'labelColors must be an object' }, 400);
    }

    // Merge new colors into existing
    const freshConfig = await readConfig(dir);
    freshConfig.labelColors = {
      ...freshConfig.labelColors,
      ...labelColors,
    };

    // Ensure all labels still have colors
    freshConfig.labelColors = ensureLabelColors(
      freshConfig.labels,
      freshConfig.labelColors,
    );

    await writeConfig(dir, freshConfig);

    // Update the in-memory config
    ctx.config = freshConfig;

    if (config.git.autoCommit) {
      const prefix = config.git.commitPrefix;
      const message = `${prefix} update label colors`;
      await commitIssueChange(dir, [join('.issues', 'config.yaml')], message);
    }

    return c.json(freshConfig);
  });

  return app;
}
