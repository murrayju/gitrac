import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { ServerContext } from '../server.ts';

export function draftRoutes(ctx: ServerContext): Hono {
  const app = new Hono();

  const draftsDir = (dir: string) => join(dir, '.issues', 'drafts');

  async function ensureDraftsDir(dir: string) {
    await mkdir(draftsDir(dir), { recursive: true });
  }

  // GET /drafts — list all drafts
  app.get('/drafts', async (c) => {
    const { dir } = ctx;
    try {
      await ensureDraftsDir(dir);
      const files = await readdir(draftsDir(dir));
      const drafts = [];
      for (const f of files.filter((f) => f.endsWith('.json'))) {
        try {
          const content = await readFile(join(draftsDir(dir), f), 'utf-8');
          const data = JSON.parse(content);
          drafts.push({ ...data, filename: f });
        } catch {
          // Skip unreadable files
        }
      }
      // Sort by savedAt descending (newest first)
      drafts.sort(
        (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
      );
      return c.json(drafts);
    } catch {
      return c.json([]);
    }
  });

  // PUT /drafts/:filename — save/update a draft
  app.put('/drafts/:filename', async (c) => {
    const { dir } = ctx;
    const filename = c.req.param('filename');
    if (
      !filename.endsWith('.json') ||
      filename.includes('/') ||
      filename.includes('..')
    ) {
      return c.json({ error: 'Invalid filename' }, 400);
    }
    await ensureDraftsDir(dir);
    const body = await c.req.json();
    body.savedAt = new Date().toISOString();
    await Bun.write(
      join(draftsDir(dir), filename),
      JSON.stringify(body, null, 2),
    );
    return c.json({ ...body, filename });
  });

  // DELETE /drafts/:filename — delete a draft
  app.delete('/drafts/:filename', async (c) => {
    const { dir } = ctx;
    const filename = c.req.param('filename');
    if (
      !filename.endsWith('.json') ||
      filename.includes('/') ||
      filename.includes('..')
    ) {
      return c.json({ error: 'Invalid filename' }, 400);
    }
    try {
      await rm(join(draftsDir(dir), filename));
    } catch {
      // Already deleted, that's fine
    }
    return c.json({ ok: true });
  });

  return app;
}
