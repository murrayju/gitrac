import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Tests for the root `install.sh` (served at https://get.gitrac.dev), run
 * against a fake `curl` so no network or real release is needed.
 */

const ROOT = join(import.meta.dir, '..');
const SCRIPT = join(ROOT, 'install.sh');

const PLATFORM = `${process.platform}-${process.arch}`;
const SUPPORTED = ['linux-x64', 'linux-arm64', 'darwin-arm64'].includes(
  PLATFORM,
);

let home: string;
let fakeBin: string;
let curlLog: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'gitrac-install-'));
  fakeBin = join(home, 'fake-bin');
  curlLog = join(home, 'curl.log');
  await mkdir(fakeBin);
  // Fake curl: records the URL, then either fails (URL contains "missing") or
  // writes a stand-in gitrac binary to the -o path.
  await Bun.write(
    join(fakeBin, 'curl'),
    `#!/bin/bash
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
echo "$url" >> "${curlLog}"
case "$url" in *missing*) echo "404" >&2; exit 22 ;; esac
printf '#!/bin/sh\\necho 9.9.9\\n' > "$out"
`,
  );
  await chmod(join(fakeBin, 'curl'), 0o755);
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function install(
  env: Record<string, string> = {},
  extraPath: string[] = [],
): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(['bash', SCRIPT], {
    env: {
      HOME: home,
      PATH: [...extraPath, fakeBin, '/usr/bin', '/bin'].join(':'),
      GITRAC_NONINTERACTIVE: '1',
      ...env,
    },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: stdout + stderr };
}

async function urls(): Promise<string[]> {
  return (await readFile(curlLog, 'utf-8')).trim().split('\n');
}

describe.if(SUPPORTED)('install.sh', () => {
  test('installs the latest release binary into ~/.local/bin', async () => {
    const { code, out } = await install();
    expect(code).toBe(0);
    expect(await urls()).toEqual([
      `https://github.com/murrayju/gitrac/releases/latest/download/gitrac-${PLATFORM}`,
    ]);
    const bin = join(home, '.local', 'bin', 'gitrac');
    expect((await stat(bin)).mode & 0o111).not.toBe(0);
    expect(out).toContain(`Detected: ${PLATFORM}`);
    expect(out).toContain(`Installed to ${bin}`);
    // Not on PATH: non-interactive installs print instructions, never edit rc files
    expect(out).toContain('is not in your PATH');
    expect(out).toContain('To add it manually');
    expect(await Bun.file(join(home, '.bashrc')).exists()).toBe(false);
    expect(await Bun.file(join(home, '.zshrc')).exists()).toBe(false);
    expect(out).toContain('gitrac 9.9.9 is installed!');
  });

  test('GITRAC_VERSION pins a release (with or without a leading v)', async () => {
    expect((await install({ GITRAC_VERSION: 'v1.2.3' })).code).toBe(0);
    expect((await install({ GITRAC_VERSION: '1.2.3' })).code).toBe(0);
    const expected = `https://github.com/murrayju/gitrac/releases/download/v1.2.3/gitrac-${PLATFORM}`;
    expect(await urls()).toEqual([expected, expected]);
  });

  test('a failed download exits 1 and installs nothing', async () => {
    const { code, out } = await install({ GITRAC_VERSION: 'missing' });
    expect(code).toBe(1);
    expect(out).toContain('Failed to download binary');
    expect(out).toContain('Version missing does not exist');
    expect(await Bun.file(join(home, '.local', 'bin', 'gitrac')).exists()).toBe(
      false,
    );
  });

  test('GITRAC_INSTALL_DIR already on PATH: no PATH warning', async () => {
    const dir = join(home, 'tools');
    const { code, out } = await install({ GITRAC_INSTALL_DIR: dir }, [dir]);
    expect(code).toBe(0);
    expect(await Bun.file(join(dir, 'gitrac')).exists()).toBe(true);
    expect(out).not.toContain('is not in your PATH');
    expect(out).toContain('gitrac 9.9.9 is installed!');
    expect(out).toContain('gitrac init');
  });

  test('does not prompt when the rc file already adds ~/.local/bin', async () => {
    await Bun.write(
      join(home, '.bashrc'),
      'export PATH="$HOME/.local/bin:$PATH"\n',
    );
    await Bun.write(
      join(home, '.zshrc'),
      'export PATH="$HOME/.local/bin:$PATH"\n',
    );
    const { code, out } = await install();
    expect(code).toBe(0);
    expect(out).not.toContain('To add it manually');
  });
});

test('install.sh is valid bash', async () => {
  const proc = Bun.spawn(['bash', '-n', SCRIPT], { stderr: 'pipe' });
  expect(await new Response(proc.stderr).text()).toBe('');
  expect(await proc.exited).toBe(0);
});
