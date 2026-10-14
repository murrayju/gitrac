/**
 * Child-process helper for lock.test.ts (not a test itself).
 *
 * Usage: bun lock.fixture.ts <mode> <lockPath> [args...]
 *   increment <lockPath> <counterPath> <times>
 *     Non-atomically increment the number in counterPath `times` times, each
 *     under the lock (read, yield, write).
 *   hold <lockPath> <markerPath> <holdMs> <staleMs>
 *     Acquire, print "acquired", wait holdMs, write markerPath, release.
 *   exit-inside <lockPath>
 *     Acquire, print "acquired", then process.exit(3) while holding the lock.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { withLock } from './lock.ts';

const [mode, lockPath, ...rest] = process.argv.slice(2);
if (!mode || !lockPath) {
  throw new Error('usage: lock.fixture.ts <mode> <lockPath> [args...]');
}

if (mode === 'increment') {
  const [counterPath, times] = rest;
  if (!counterPath) throw new Error('counterPath required');
  for (let i = 0; i < Number(times); i++) {
    await withLock(lockPath, async () => {
      const value = Number(await readFile(counterPath, 'utf-8'));
      await Bun.sleep(1);
      await writeFile(counterPath, String(value + 1));
    });
  }
} else if (mode === 'hold') {
  const [markerPath, holdMs, staleMs] = rest;
  if (!markerPath) throw new Error('markerPath required');
  await withLock(
    lockPath,
    async () => {
      console.log('acquired');
      await Bun.sleep(Number(holdMs));
      await writeFile(markerPath, 'released');
    },
    { staleMs: Number(staleMs) },
  );
} else if (mode === 'exit-inside') {
  await withLock(lockPath, async () => {
    console.log('acquired');
    process.exit(3);
  });
} else {
  throw new Error(`unknown mode ${mode}`);
}
