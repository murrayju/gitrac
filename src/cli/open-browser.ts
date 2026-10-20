/**
 * Open the web UI in the default browser after `gitrac serve` starts (#115).
 */

/** Inputs of the "open a browser?" decision. */
export interface OpenDecisionInput {
  /** False with `--no-open` / `-n`. */
  open: boolean;
  /** Whether stdout is a terminal. */
  isTTY: boolean;
  env: Record<string, string | undefined>;
}

/** Whether an environment flag is set (not empty, `0` or `false`). */
function envFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false';
}

/**
 * Decide if `gitrac serve` opens a browser. It does not when the user
 * passes `--no-open`, when stdout is not a terminal (scripts, tests,
 * agents), when `CI` is set, or when `GITRAC_NO_OPEN` is set.
 */
export function shouldOpenBrowser(input: OpenDecisionInput): boolean {
  if (!input.open || !input.isTTY) return false;
  return !envFlag(input.env.CI) && !envFlag(input.env.GITRAC_NO_OPEN);
}

/** The command that opens `url` in the default browser on `platform`. */
export function openerCommand(platform: string, url: string): string[] {
  if (platform === 'darwin') return ['open', url];
  // `start` takes the first quoted argument as a window title.
  if (platform === 'win32') return ['cmd', '/c', 'start', '""', url];
  return ['xdg-open', url];
}

/** Minimal process handle, so tests can replace `Bun.spawn`. */
export interface SpawnedOpener {
  exited: Promise<number>;
  unref(): void;
}

export interface OpenBrowserDeps {
  platform?: string;
  spawn?: (cmd: string[]) => SpawnedOpener;
  /** Print a note on failure (default: stderr). */
  warn?: (message: string) => void;
}

function spawnDetached(cmd: string[]): SpawnedOpener {
  return Bun.spawn(cmd, {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    detached: true,
  });
}

/**
 * Open `url` in the default browser. This never throws: on failure it
 * prints a short note, because the server runs well without a browser.
 */
export function openBrowser(url: string, deps: OpenBrowserDeps = {}): void {
  const platform = deps.platform ?? process.platform;
  const spawn = deps.spawn ?? spawnDetached;
  const warn = deps.warn ?? ((message) => process.stderr.write(`${message}\n`));
  const cmd = openerCommand(platform, url);
  const note = (detail: string) =>
    warn(`  Note: could not open a browser (${detail}). Open ${url}\n`);
  try {
    const proc = spawn(cmd);
    proc.unref();
    proc.exited.then(
      (code) => {
        if (code !== 0) note(`${cmd[0]} exited with code ${code}`);
      },
      (err) => note(String(err)),
    );
  } catch (err) {
    note(err instanceof Error ? err.message : String(err));
  }
}
