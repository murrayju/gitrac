import { join } from 'node:path';
import { Hono } from 'hono';
import { ensureLabelColors } from '../../core/config.ts';
import type { Assignee } from '../../core/types.ts';
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
    const { labels } = body;

    if (
      typeof labels !== 'object' ||
      labels === null ||
      Array.isArray(labels)
    ) {
      return c.json({ error: 'labels must be an object' }, 400);
    }

    // Merge new colors into existing
    const freshConfig = await readConfig(dir);
    freshConfig.labels = {
      ...freshConfig.labels,
      ...labels,
    };

    // Ensure all labels still have colors
    freshConfig.labels = ensureLabelColors(
      Object.keys(freshConfig.labels),
      freshConfig.labels,
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

  // PATCH /config/assignees — update assignees list
  app.patch('/config/assignees', async (c) => {
    const { dir, config } = ctx;
    const body = await c.req.json();
    const { assignees } = body;

    if (!Array.isArray(assignees)) {
      return c.json({ error: 'assignees must be an array' }, 400);
    }

    // Validate each assignee has name and email strings
    for (const a of assignees) {
      const entry = a as Record<string, unknown>;
      if (
        typeof entry.name !== 'string' ||
        typeof entry.email !== 'string' ||
        !entry.name.trim() ||
        !entry.email.trim()
      ) {
        return c.json(
          {
            error:
              'Each assignee must have non-empty "name" and "email" strings',
          },
          400,
        );
      }
    }

    const freshConfig = await readConfig(dir);
    freshConfig.assignees = assignees as Assignee[];

    await writeConfig(dir, freshConfig);
    ctx.config = freshConfig;

    if (config.git.autoCommit) {
      const prefix = config.git.commitPrefix;
      const message = `${prefix} update assignees`;
      await commitIssueChange(dir, [join('.issues', 'config.yaml')], message);
    }

    return c.json(freshConfig);
  });

  return app;
}
