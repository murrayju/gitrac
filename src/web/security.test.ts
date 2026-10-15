import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import {
  antiFraming,
  checkRequest,
  isAllowedHostname,
  isLoopbackHost,
  isWildcardHost,
  withFrameAncestorsNone,
} from './security.ts';

function req(
  method: string,
  headers: Record<string, string>,
  url = 'http://localhost:3000/api/issues',
) {
  return { method, url, headers: new Headers(headers) };
}

describe('isAllowedHostname', () => {
  test('accepts loopback names and IP literals', () => {
    for (const h of [
      'localhost',
      'LOCALHOST',
      'localhost.',
      'app.localhost',
      '127.0.0.1',
      '[::1]',
      '192.168.1.5',
    ]) {
      expect(isAllowedHostname(h, '127.0.0.1')).toBe(true);
    }
  });

  test('rejects other names (DNS rebinding)', () => {
    for (const h of ['evil.example', 'localhost.evil.example', '', 'x']) {
      expect(isAllowedHostname(h, '127.0.0.1')).toBe(false);
    }
    expect(isAllowedHostname('evil.example', '0.0.0.0')).toBe(false);
  });

  test('accepts the explicitly bound host name', () => {
    expect(isAllowedHostname('mybox.lan', 'mybox.lan')).toBe(true);
    expect(isAllowedHostname('MyBox.lan.', 'mybox.lan')).toBe(true);
    expect(isAllowedHostname('other.lan', 'mybox.lan')).toBe(false);
  });
});

describe('isLoopbackHost / isWildcardHost', () => {
  test('classifies bind hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isWildcardHost('0.0.0.0')).toBe(true);
    expect(isWildcardHost('::')).toBe(true);
    expect(isWildcardHost('127.0.0.1')).toBe(false);
  });
});

describe('checkRequest', () => {
  const bind = '127.0.0.1';

  test('rejects any request with a foreign Host, even GET', () => {
    const r = checkRequest(req('GET', { host: 'evil.example:3000' }), bind);
    expect(r.ok).toBe(false);
  });

  test('rejects a malformed Host', () => {
    expect(checkRequest(req('GET', { host: 'a@b' }), bind).ok).toBe(false);
  });

  test('falls back to the URL host when there is no Host header', () => {
    expect(checkRequest(req('GET', {}), bind).ok).toBe(true);
    expect(
      checkRequest(req('GET', {}, 'http://evil.example/api/issues'), bind).ok,
    ).toBe(false);
  });

  test('allows GET with a cross-origin Origin (response is unreadable)', () => {
    const r = checkRequest(
      req('GET', { host: 'localhost:3000', origin: 'https://evil.example' }),
      bind,
    );
    expect(r.ok).toBe(true);
  });

  test('allows same-origin mutations', () => {
    for (const [host, origin] of [
      ['localhost:3000', 'http://localhost:3000'],
      ['127.0.0.1:3000', 'http://127.0.0.1:3000'],
      ['[::1]:3000', 'http://[::1]:3000'],
      ['localhost', 'http://localhost:80'],
    ] as const) {
      expect(checkRequest(req('POST', { host, origin }), bind).ok).toBe(true);
    }
  });

  test('allows mutations via the Vite dev proxy (Host preserved)', () => {
    const r = checkRequest(
      req('PATCH', { host: 'localhost:5173', origin: 'http://localhost:5173' }),
      bind,
    );
    expect(r.ok).toBe(true);
  });

  test('rejects cross-origin mutations', () => {
    for (const origin of [
      'https://evil.example',
      'http://localhost:8080',
      'http://127.0.0.1:3000', // different host spelling than Host
      'null',
      'file://',
      'garbage',
    ]) {
      const r = checkRequest(
        req('POST', { host: 'localhost:3000', origin }),
        bind,
      );
      expect(r.ok).toBe(false);
    }
  });

  test('without Origin, rejects cross-site Sec-Fetch-Site', () => {
    for (const site of ['cross-site', 'same-site']) {
      const r = checkRequest(
        req('DELETE', { host: 'localhost:3000', 'sec-fetch-site': site }),
        bind,
      );
      expect(r.ok).toBe(false);
    }
    for (const site of ['same-origin', 'none']) {
      const r = checkRequest(
        req('DELETE', { host: 'localhost:3000', 'sec-fetch-site': site }),
        bind,
      );
      expect(r.ok).toBe(true);
    }
  });

  test('allows non-browser clients with no Origin', () => {
    expect(checkRequest(req('POST', { host: 'localhost:3000' }), bind).ok).toBe(
      true,
    );
  });
});

describe('withFrameAncestorsNone', () => {
  test('creates a policy when there is none', () => {
    expect(withFrameAncestorsNone(null)).toBe("frame-ancestors 'none'");
    expect(withFrameAncestorsNone('  ')).toBe("frame-ancestors 'none'");
  });

  test('appends to an existing policy, keeping its directives', () => {
    expect(withFrameAncestorsNone("default-src 'none'; sandbox")).toBe(
      "default-src 'none'; sandbox; frame-ancestors 'none'",
    );
    expect(withFrameAncestorsNone("default-src 'self';")).toBe(
      "default-src 'self'; frame-ancestors 'none'",
    );
  });

  test('keeps an explicit frame-ancestors directive', () => {
    expect(withFrameAncestorsNone("Frame-Ancestors 'self'; sandbox")).toBe(
      "Frame-Ancestors 'self'; sandbox",
    );
  });
});

describe('antiFraming', () => {
  function app(): Hono {
    const a = new Hono();
    a.use('*', antiFraming());
    a.get('/plain', (c) => c.html('<p>hi</p>'));
    a.get(
      '/csp',
      () =>
        new Response('x', {
          headers: { 'content-security-policy': "default-src 'none'" },
        }),
    );
    a.get('/immutable', () => Response.redirect('http://localhost/plain'));
    a.get('/throws', () => {
      throw new Error('boom');
    });
    a.onError((_err, c) => c.text('error', 500));
    return a;
  }

  test('adds frame-ancestors and X-Frame-Options to every response', async () => {
    for (const path of ['/plain', '/missing', '/throws']) {
      const res = await app().request(`http://localhost${path}`);
      expect(res.headers.get('content-security-policy')).toBe(
        "frame-ancestors 'none'",
      );
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    }
  });

  test("merges into the route's own CSP", async () => {
    const res = await app().request('http://localhost/csp');
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  test('handles responses with immutable headers', async () => {
    const res = await app().request('http://localhost/immutable');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost/plain');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });
});
