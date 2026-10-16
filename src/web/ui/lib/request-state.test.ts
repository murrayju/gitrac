import { describe, expect, test } from 'bun:test';
import { ApiError } from '../api.ts';
import { trackRequest } from './request-state.ts';

function recorder() {
  const log: string[] = [];
  return {
    log,
    setters: {
      setBusy: (busy: boolean) => log.push(`busy ${busy}`),
      setError: (error: string | null) => log.push(`error ${error}`),
    },
  };
}

describe('trackRequest', () => {
  test('stays busy until the action settles (#100)', async () => {
    const { log, setters } = recorder();
    let finish!: () => void;
    const done = trackRequest(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
      setters,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(['busy true', 'error null']);
    finish();
    expect(await done).toBe(true);
    expect(log).toEqual(['busy true', 'error null', 'busy false']);
  });

  test("a failure shows the server's message and does not reject", async () => {
    const { log, setters } = recorder();
    const ok = await trackRequest(async () => {
      throw new ApiError(400, JSON.stringify({ error: 'Body is required' }));
    }, setters);
    expect(ok).toBe(false);
    expect(log).toEqual([
      'busy true',
      'error null',
      'error Body is required',
      'busy false',
    ]);
  });

  test('a network failure says so', async () => {
    const { log, setters } = recorder();
    await trackRequest(async () => {
      throw new TypeError('Failed to fetch');
    }, setters);
    expect(log).toContain('error Network error: could not reach the server');
  });
});
