// Helpers for the recordings: processes, screen capture and a visible cursor.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Start a long-running process. The caller must call `.kill()` on the result. */
export function startProcess(command, args, options) {
  const child = spawn(command, args, { stdio: 'ignore', ...options });
  child.on('error', (error) => {
    throw error;
  });
  return child;
}

/** Wait until an HTTP URL answers, or fail after `timeoutMs`. */
export async function waitForUrl(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is not up yet.
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

/**
 * Record a page with the Chrome screencast API and write a 30 fps MP4.
 * The screencast captures device pixels, so the output is sharper than
 * Playwright's built-in video recording.
 */
export async function startScreenCapture(page, outputFile) {
  const framesDir = `${outputFile}.frames`;
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const viewport = page.viewportSize();
  const scale = await page.evaluate(() => window.devicePixelRatio);
  const session = await page.context().newCDPSession(page);
  const frames = [];
  session.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(
      framesDir,
      `${String(frames.length).padStart(6, '0')}.jpg`,
    );
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, timestamp: metadata.timestamp });
    session.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await session.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 95,
    maxWidth: viewport.width * scale,
    maxHeight: viewport.height * scale,
  });
  const startedAt = Date.now() / 1000;

  return {
    /** Seconds since the capture started. */
    elapsed: () => Date.now() / 1000 - startedAt,
    async stop() {
      const stoppedAt = Date.now() / 1000;
      await session.send('Page.stopScreencast');
      await session.detach();
      if (frames.length === 0)
        throw new Error('The screencast produced no frames');
      const lines = [];
      frames.forEach((frame, index) => {
        const start = index === 0 ? startedAt : frame.timestamp;
        const end = frames[index + 1]?.timestamp ?? stoppedAt;
        lines.push(
          `file '${frame.file}'`,
          `duration ${Math.max(end - start, 0.001).toFixed(4)}`,
        );
      });
      // The concat demuxer ignores the duration of the last entry unless the file repeats.
      lines.push(`file '${frames.at(-1).file}'`);
      const listFile = join(framesDir, 'frames.txt');
      writeFileSync(listFile, `${lines.join('\n')}\n`);
      const result = spawnSync(
        'ffmpeg',
        [
          '-y',
          '-loglevel',
          'error',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          listFile,
          '-vf',
          'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2',
          '-c:v',
          'libx264',
          '-preset',
          'slow',
          '-crf',
          '18',
          '-pix_fmt',
          'yuv420p',
          outputFile,
        ],
        { stdio: 'inherit' },
      );
      if (result.status !== 0)
        throw new Error(`ffmpeg failed for ${outputFile}`);
      rmSync(framesDir, { recursive: true, force: true });
      return { duration: stoppedAt - startedAt };
    },
  };
}

/** Show a mouse cursor in the page. Headless Chrome does not draw one. */
export const cursorScript = () => {
  window.addEventListener('DOMContentLoaded', () => {
    const cursor = document.createElement('div');
    cursor.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 14.8 L11.6 21.5 L14.4 20.2 L11.4 13.7 L17.5 13.4 Z" fill="white" stroke="black" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(cursor.style, {
      position: 'fixed',
      left: '-40px',
      top: '-40px',
      zIndex: '2147483647',
      pointerEvents: 'none',
      filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.5))',
    });
    const ring = document.createElement('div');
    Object.assign(ring.style, {
      position: 'fixed',
      width: '28px',
      height: '28px',
      marginLeft: '-14px',
      marginTop: '-14px',
      borderRadius: '50%',
      background: 'rgba(129,140,248,.45)',
      zIndex: '2147483646',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity .35s, transform .35s',
    });
    document.body.append(ring, cursor);
    window.addEventListener(
      'mousemove',
      (event) => {
        cursor.style.left = `${event.clientX - 4}px`;
        cursor.style.top = `${event.clientY - 2}px`;
      },
      true,
    );
    window.addEventListener(
      'mousedown',
      (event) => {
        ring.style.left = `${event.clientX}px`;
        ring.style.top = `${event.clientY}px`;
        ring.style.transition = 'none';
        ring.style.opacity = '1';
        ring.style.transform = 'scale(.6)';
        requestAnimationFrame(() => {
          ring.style.transition = 'opacity .45s, transform .45s';
          ring.style.opacity = '0';
          ring.style.transform = 'scale(1.4)';
        });
      },
      true,
    );
  });
};

/** Move the mouse along an eased path, like a person would. */
export function createMouse(page) {
  let position = { x: 600, y: 400 };
  async function moveTo(x, y, durationMs = 550) {
    const steps = Math.max(Math.round(durationMs / 16), 2);
    const from = position;
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      await page.mouse.move(
        from.x + (x - from.x) * eased,
        from.y + (y - from.y) * eased,
      );
      await sleep(16);
    }
    position = { x, y };
  }
  return {
    moveTo,
    async moveToLocator(locator, durationMs) {
      await locator.waitFor({ state: 'visible' });
      const box = await locator.boundingBox();
      if (!box) throw new Error('The element has no bounding box');
      await moveTo(
        box.x + Math.min(box.width / 2, 40),
        box.y + box.height / 2,
        durationMs,
      );
    },
    async click(locator, durationMs) {
      await this.moveToLocator(locator, durationMs);
      await sleep(120);
      await page.mouse.down();
      await sleep(70);
      await page.mouse.up();
    },
  };
}
