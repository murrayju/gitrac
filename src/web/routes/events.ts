import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ServerContext } from '../server.ts';

/**
 * How often to write an SSE comment on an otherwise idle stream. Must stay
 * well under Bun's default `idleTimeout` (10s) and typical proxy timeouts so
 * the connection is never closed for inactivity.
 */
export const SSE_KEEP_ALIVE_MS = 5000;

export interface EventsRouteOptions {
  /** Keep-alive interval in ms (default: {@link SSE_KEEP_ALIVE_MS}). */
  keepAliveMs?: number;
}

/** Minimal slice of Bun's `Server` used to lift the idle timeout. */
interface TimeoutCapableServer {
  timeout(request: Request, seconds: number): void;
}

function isTimeoutCapable(env: unknown): env is TimeoutCapableServer {
  return (
    typeof env === 'object' &&
    env !== null &&
    typeof (env as { timeout?: unknown }).timeout === 'function'
  );
}

export function eventsRoute(
  ctx: ServerContext,
  options: EventsRouteOptions = {},
): Hono {
  const app = new Hono();
  const keepAliveMs = options.keepAliveMs ?? SSE_KEEP_ALIVE_MS;

  app.get('/events', (c) => {
    const { watcher } = ctx;

    // Under Bun.serve, `c.env` is the Server. Disable the idle timeout for
    // this long-lived request only (other routes keep the default); the
    // keep-alive below also covers proxies (e.g. the Vite dev server).
    if (isTimeoutCapable(c.env)) {
      c.env.timeout(c.req.raw, 0);
    }

    return streamSSE(c, async (stream) => {
      const onChange = () => {
        if (stream.aborted) return;
        stream.writeSSE({ event: 'issues-changed', data: '{}' });
      };

      watcher.on('change', onChange);

      let wake: (() => void) | null = null;
      const cleanup = () => {
        watcher.off('change', onChange);
        wake?.();
      };
      stream.onAbort(cleanup);
      // Belt and braces: also stop when the request itself is aborted.
      c.req.raw.signal.addEventListener('abort', () => stream.abort(), {
        once: true,
      });

      try {
        // Clients refetch on `connected`, so anything that changed while
        // they were disconnected is picked up.
        await stream.writeSSE({ event: 'connected', data: '{}' });

        // Keep the stream open, writing a comment line periodically so the
        // connection never looks idle.
        while (!stream.aborted) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, keepAliveMs);
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          wake = null;
          if (stream.aborted) break;
          await stream.write(': keep-alive\n\n');
        }
      } finally {
        cleanup();
      }
    });
  });

  return app;
}
