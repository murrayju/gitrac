/** Highest TCP port. */
const MAX_PORT = 65535;

/** How many ports `gitrac serve` tries when no port is given (#118). */
export const DEFAULT_PORT_ATTEMPTS = 20;

/** Whether `err` is the "address already in use" error of a bind call. */
export function isAddressInUse(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'EADDRINUSE'
  );
}

/**
 * Bind to the first free port from `start`, with at most `attempts` tries.
 *
 * `bind` must throw an error with code `EADDRINUSE` when the port is busy
 * (as `Bun.serve` does). We do not probe ports first, because another
 * process can take a probed port before we bind it. Port 0 (any free port)
 * and other bind errors are not retried. When every port is busy, the error
 * names the port or the range that was tried.
 */
export function bindFirstFreePort<T>(
  bind: (port: number) => T,
  start: number,
  attempts: number,
): T {
  const last = start === 0 ? 0 : Math.min(start + attempts - 1, MAX_PORT);
  for (let port = start; ; port++) {
    try {
      return bind(port);
    } catch (err) {
      if (!isAddressInUse(err)) throw err;
      if (port >= last) {
        const what =
          last > start
            ? `ports ${start}-${last} are all in use`
            : `port ${start} is already in use`;
        throw Object.assign(new Error(what, { cause: err }), {
          code: 'EADDRINUSE',
        });
      }
    }
  }
}
