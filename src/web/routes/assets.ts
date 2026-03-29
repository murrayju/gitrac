import { mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { ServerContext } from '../server.ts';

const ALLOWED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
]);

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

function assetsDir(dir: string): string {
  return join(dir, '.issues', 'assets');
}

export function assetRoutes(ctx: ServerContext): Hono {
  const app = new Hono();

  // POST /issues/assets — upload an image
  app.post('/issues/assets', async (c) => {
    const { dir } = ctx;

    const body = await c.req.parseBody();
    const file = body.file;

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'file is required' }, 400);
    }

    const ext = extname(file.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return c.json({ error: `Unsupported file type: ${ext}` }, 400);
    }

    const id = nanoid();
    const filename = `${id}${ext}`;
    const dest = join(assetsDir(dir), filename);

    // Ensure assets directory exists
    await mkdir(assetsDir(dir), { recursive: true });

    // Write using Bun API
    const buffer = await file.arrayBuffer();
    await Bun.write(dest, buffer);

    const url = `/api/issues/assets/${filename}`;
    return c.json({ filename, url }, 201);
  });

  // GET /issues/assets/:filename — serve an image
  app.get('/issues/assets/:filename', async (c) => {
    const { dir } = ctx;
    const filename = c.req.param('filename');

    // Prevent path traversal
    if (filename.includes('/') || filename.includes('..')) {
      return c.json({ error: 'Invalid filename' }, 400);
    }

    const filePath = join(assetsDir(dir), filename);
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      return c.json({ error: 'Asset not found' }, 404);
    }

    const ext = extname(filename).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

    return new Response(file, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  });

  return app;
}
