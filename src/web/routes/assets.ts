import { mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { nanoid } from 'nanoid';
import { isAssetFilename } from '../../core/assets.ts';
import type { ServerContext } from '../server.ts';

/** Maximum size of an uploaded asset (and of the upload request body). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Extensions accepted for upload. SVG is deliberately excluded: it can carry
 * script and would be served from the app's own origin (stored XSS).
 */
const ALLOWED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
]);

/**
 * Content types used when serving assets. `.svg` stays here so SVGs already
 * committed to a repo still render in `<img>`; the sandbox CSP below keeps them
 * from running script if opened directly.
 */
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

const tooLarge = {
  error: `Upload too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)} MiB)`,
};

function assetsDir(dir: string): string {
  return join(dir, '.issues', 'assets');
}

/** Serve a single asset file by filename. Shared by API and direct routes. */
export function serveAsset(
  ctx: ServerContext,
): (c: { req: { param: (name: string) => string } }) => Promise<Response> {
  return async (c) => {
    const { dir } = ctx;
    const filename = c.req.param('filename');

    // Prevent path traversal
    if (!isAssetFilename(filename)) {
      return Response.json({ error: 'Invalid filename' }, { status: 400 });
    }

    const filePath = join(assetsDir(dir), filename);
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      return Response.json({ error: 'Asset not found' }, { status: 404 });
    }

    const ext = extname(filename).toLowerCase();
    const contentType = MIME_TYPES[ext];

    const headers: Record<string, string> = {
      'Content-Type': contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      // Assets are user content served from the app's origin: never sniff,
      // and if one is opened directly (rather than via <img>), render it in a
      // sandboxed opaque origin with no script.
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    };
    if (!contentType) {
      // Unknown file types (e.g. an .html file committed to .issues/assets)
      // are downloaded, never rendered.
      headers['Content-Disposition'] = 'attachment';
    }

    return new Response(file, { headers });
  };
}

export function assetRoutes(ctx: ServerContext): Hono {
  const app = new Hono();

  // POST /issues/assets — upload an image
  app.post(
    '/issues/assets',
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES,
      onError: (c) => c.json(tooLarge, 413),
    }),
    async (c) => {
      const { dir } = ctx;

      let body: Awaited<ReturnType<typeof c.req.parseBody>>;
      try {
        body = await c.req.parseBody();
      } catch (err) {
        // A streamed body that exceeds the limit errors out mid-parse.
        if (err instanceof Error && err.name === 'BodyLimitError') {
          return c.json(tooLarge, 413);
        }
        return c.json({ error: 'Invalid upload body' }, 400);
      }
      const file = body.file;

      if (!file || !(file instanceof File)) {
        return c.json({ error: 'file is required' }, 400);
      }

      const ext = extname(file.name).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return c.json({ error: `Unsupported file type: ${ext}` }, 400);
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        return c.json(tooLarge, 413);
      }

      const id = nanoid();
      const filename = `${id}${ext}`;
      const dest = join(assetsDir(dir), filename);

      // Ensure assets directory exists
      await mkdir(assetsDir(dir), { recursive: true });

      // Write using Bun API
      const buffer = await file.arrayBuffer();
      await Bun.write(dest, buffer);

      const url = `/.issues/assets/${filename}`;
      return c.json({ filename, url }, 201);
    },
  );

  // GET /issues/assets/:filename — serve an image (legacy /api path)
  app.get('/issues/assets/:filename', serveAsset(ctx));

  return app;
}
