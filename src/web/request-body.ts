import type { Context } from 'hono';

/** Treat a non-object JSON body as empty so field checks reject it. */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Parse a JSON request body, returning undefined if it isn't valid JSON. */
export async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}
