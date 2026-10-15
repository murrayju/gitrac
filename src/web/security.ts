import { isIP } from 'node:net';
import type { MiddlewareHandler } from 'hono';

/** Default interface the web server binds to (loopback only). */
export const DEFAULT_HOST = '127.0.0.1';

/** Methods that never mutate state; exempt from the Origin check. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Bind addresses that mean "all interfaces". */
const WILDCARD_HOSTS = new Set(['', '0.0.0.0', '::', '[::]']);

/**
 * Normalize a `Host` header value (or an origin's host) via the URL parser:
 * lowercases, strips default ports, canonicalizes IP literals, and drops a
 * trailing dot from the hostname. Returns null if it doesn't parse.
 */
function parseHost(value: string): { host: string; hostname: string } | null {
  if (!value || /[/?#@\\\s]/.test(value)) return null;
  try {
    const url = new URL(`http://${value}`);
    const hostname = url.hostname.replace(/\.$/, '');
    const host = url.port ? `${hostname}:${url.port}` : hostname;
    return { host, hostname };
  } catch {
    return null;
  }
}

function isIpLiteral(hostname: string): boolean {
  return isIP(hostname.replace(/^\[|\]$/g, '')) !== 0;
}

/** Whether the bind host is a loopback address/name. */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127\./.test(h);
}

/** Whether the bind host means "all interfaces". */
export function isWildcardHost(host: string): boolean {
  return WILDCARD_HOSTS.has(host.trim());
}

/**
 * Whether a request `Host` hostname may be served (DNS-rebinding protection).
 *
 * A DNS-rebinding attack needs a domain name the attacker controls that
 * resolves to this machine, so we accept:
 * - IP literals (an IP can't be rebound — if the browser reached us via an IP,
 *   it really meant us),
 * - `localhost` and `*.localhost` (browsers resolve these to loopback
 *   themselves, never via DNS),
 * - the name the server was explicitly bound to with `--host`.
 *
 * Any other name (e.g. `attacker.example` rebound to 127.0.0.1) is rejected.
 */
export function isAllowedHostname(hostname: string, bindHost: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, '');
  if (!name) return false;
  if (isIpLiteral(name)) return true;
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  const bind = bindHost.trim().toLowerCase().replace(/\.$/, '');
  return !isWildcardHost(bind) && !isIpLiteral(bind) && name === bind;
}

export type RequestCheck = { ok: true } | { ok: false; reason: string };

/**
 * Decide whether a request may proceed.
 *
 * 1. Every request must carry an allowed `Host` (see {@link isAllowedHostname}).
 * 2. Mutating requests (anything but GET/HEAD/OPTIONS) must be same-origin:
 *    if an `Origin` header is present its host must equal the `Host` header
 *    (so `http://localhost:5173` via the Vite proxy, which preserves `Host`,
 *    is fine, but any other site or port is not). Without `Origin`, a
 *    `Sec-Fetch-Site` other than `same-origin`/`none` is rejected; requests
 *    with neither header are non-browser clients (curl, scripts) and allowed.
 */
export function checkRequest(
  req: { method: string; url: string; headers: Headers },
  bindHost: string,
): RequestCheck {
  const rawHost = req.headers.get('host') ?? new URL(req.url).host;
  const host = parseHost(rawHost);
  if (!host || !isAllowedHostname(host.hostname, bindHost)) {
    return { ok: false, reason: `Host "${rawHost}" is not allowed` };
  }

  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return { ok: true };
  }

  const origin = req.headers.get('origin');
  if (origin !== null) {
    let originHost: { host: string } | null = null;
    try {
      const url = new URL(origin);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        originHost = parseHost(url.host);
      }
    } catch {
      // Opaque ("null") or malformed origin
    }
    if (!originHost || originHost.host !== host.host) {
      return { ok: false, reason: `Cross-origin request from "${origin}"` };
    }
    return { ok: true };
  }

  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return { ok: false, reason: `Cross-origin request (${fetchSite})` };
  }
  return { ok: true };
}

/**
 * Hono middleware rejecting requests with a foreign `Host` (DNS rebinding) and
 * cross-origin mutating requests (CSRF) with 403. The server has no
 * authentication, so this plus binding to loopback by default is what keeps
 * other machines and other websites from reading or modifying issues.
 */
export function requestGuard(bindHost: string): MiddlewareHandler {
  return async (c, next) => {
    const result = checkRequest(c.req.raw, bindHost);
    if (!result.ok) {
      return c.json({ error: `Forbidden: ${result.reason}` }, 403);
    }
    await next();
  };
}

/** CSP directive forbidding any page from framing the response. */
const FRAME_ANCESTORS_NONE = "frame-ancestors 'none'";

/**
 * Add `frame-ancestors 'none'` to a Content-Security-Policy value, keeping its
 * other directives. A policy that already has a `frame-ancestors` directive is
 * returned unchanged (the route chose it deliberately).
 */
export function withFrameAncestorsNone(csp: string | null): string {
  const policy = (csp ?? '').trim().replace(/;+\s*$/, '');
  if (!policy) return FRAME_ANCESTORS_NONE;
  const hasFrameAncestors = policy
    .split(';')
    .some((d) => d.trim().toLowerCase().split(/\s+/)[0] === 'frame-ancestors');
  return hasFrameAncestors ? policy : `${policy}; ${FRAME_ANCESTORS_NONE}`;
}

function setAntiFramingHeaders(headers: Headers): void {
  headers.set(
    'Content-Security-Policy',
    withFrameAncestorsNone(headers.get('Content-Security-Policy')),
  );
  headers.set('X-Frame-Options', 'DENY');
}

/**
 * Hono middleware forbidding other sites from framing any response
 * (clickjacking: the server has no auth and its UI can make commits). Adds
 * `Content-Security-Policy: frame-ancestors 'none'` — merged into a CSP the
 * route already set, e.g. the asset sandbox policy — and `X-Frame-Options:
 * DENY` (for browsers without `frame-ancestors`). Register it first so even
 * the request guard's 403s carry the headers.
 */
export function antiFraming(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    try {
      setAntiFramingHeaders(c.res.headers);
    } catch {
      // Immutable headers (e.g. a proxied fetch Response): copy and retry.
      c.res = new Response(c.res.body, c.res);
      setAntiFramingHeaders(c.res.headers);
    }
  };
}
