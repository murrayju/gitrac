import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ServerContext } from '../server.ts';

export function eventsRoute(ctx: ServerContext): Hono {
  const app = new Hono();

  app.get('/events', (c) => {
    const { watcher } = ctx;

    return streamSSE(c, async (stream) => {
      const onChange = () => {
        stream.writeSSE({ event: 'issues-changed', data: '{}' });
      };

      watcher.on('change', onChange);

      // Clean up on disconnect
      stream.onAbort(() => {
        watcher.off('change', onChange);
      });

      // Send initial connection event
      await stream.writeSSE({ event: 'connected', data: '{}' });

      // Keep the stream open
      while (true) {
        await stream.sleep(30000);
      }
    });
  });

  return app;
}
