// Record the real gitrac CLI, web UI and a coding agent for the promo video.
//
// Usage: node record/record.mjs [scene...]
// Scenes run in this order and share one demo repository:
//   author  - a person writes and prioritizes issues in the web UI
//   files   - the CLI shows the same issues; every change is a commit
//   agent   - a coding agent works through the backlog (the web UI updates live)
//   commit  - the fix and the closed issue are in one commit
// The `author` scene creates a fresh demo repository. Run all scenes together
// unless you only re-record a later scene against the same repository.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import {
  createMouse,
  cursorScript,
  sleep,
  startProcess,
  startScreenCapture,
  waitForUrl,
} from './lib.mjs';

const videoDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(videoDir, '..');
const outputDir = join(videoDir, 'public', 'recordings');
const workDir = process.env.RECORD_WORK_DIR ?? '/tmp/gitrac-video';
const demoDir = join(workDir, 'notes');
const binDir = join(workDir, 'bin');
const piDir = join(workDir, 'pi-agent');
const gitracBinary = join(repoRoot, 'bin', 'gitrac');
const agentModel =
  process.env.AGENT_MODEL ?? 'openrouter/anthropic/claude-opus-5.5';
const webPort = 3100;
const webUrl = `http://127.0.0.1:${webPort}`;

const allScenes = ['author', 'files', 'agent', 'commit'];
const scenes = process.argv.length > 2 ? process.argv.slice(2) : allScenes;
for (const scene of scenes) {
  if (!allScenes.includes(scene)) throw new Error(`Unknown scene: ${scene}`);
}
if (!existsSync(gitracBinary)) {
  throw new Error(
    `Build gitrac first (./bun run scripts/build.ts): ${gitracBinary} is missing`,
  );
}

const terminalTheme = {
  background: '#0f1221',
  foreground: '#e6e8f2',
  cursor: '#8b8ff8',
  cursorAccent: '#0f1221',
  selectionBackground: '#2a2f55',
  black: '#1b1f36',
  red: '#f07178',
  green: '#a5e075',
  yellow: '#ffcb6b',
  blue: '#82aaff',
  magenta: '#c4a7ff',
  cyan: '#89ddff',
  white: '#d0d4e6',
  brightBlack: '#6b7194',
  brightRed: '#ff8b92',
  brightGreen: '#c3e88d',
  brightYellow: '#ffe08a',
  brightBlue: '#9cc4ff',
  brightMagenta: '#d7c2ff',
  brightCyan: '#a6f0ff',
  brightWhite: '#ffffff',
};

const baseEnv = {
  ...process.env,
  PATH: `${binDir}:${process.env.PATH}`,
  BASH_SILENCE_DEPRECATION_WARNING: '1',
  PS1: '\\[\\e[38;2;139;143;248m\\]notes\\[\\e[0m\\] $ ',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
};

/** Identity for the agent's shell: git (and so gitrac) sees agent-1. */
const agentEnv = {
  ...baseEnv,
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'user.name',
  GIT_CONFIG_VALUE_0: 'agent-1',
  GIT_CONFIG_KEY_1: 'user.email',
  GIT_CONFIG_VALUE_1: 'agent-1@example.com',
  PI_CODING_AGENT_DIR: piDir,
  PI_SKIP_VERSION_CHECK: '1',
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: baseEnv,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.stderr}${result.stdout}`,
    );
  }
  return result.stdout;
}

function prepareWorkDir() {
  mkdirSync(binDir, { recursive: true });
  const shim = join(binDir, 'gitrac');
  if (!existsSync(shim)) symlinkSync(gitracBinary, shim);
  // `pi` in the recorded shell runs the real agent without personal add-ons.
  const piPath = run('which', ['pi'], { env: process.env }).trim();
  writeFileSync(
    join(binDir, 'pi'),
    `#!/bin/sh\nexec '${piPath}' --no-session --no-extensions --no-mcp --no-skills "$@"\n`,
    { mode: 0o755 },
  );
  // A clean agent config: no extensions, sessions or personal settings.
  mkdirSync(piDir, { recursive: true });
  const authFile = join(piDir, 'auth.json');
  const userAuth = join(process.env.HOME, '.pi', 'agent', 'auth.json');
  if (!existsSync(authFile) && existsSync(userAuth))
    symlinkSync(userAuth, authFile);
  const [provider, ...model] = agentModel.split('/');
  writeFileSync(
    join(piDir, 'settings.json'),
    `${JSON.stringify(
      {
        defaultProvider: provider,
        defaultModel: model.join('/'),
        defaultThinkingLevel: 'medium',
        theme: 'dark',
        quietStartup: true,
        lastChangelogVersion: '1.3.0',
      },
      null,
      2,
    )}\n`,
  );
  mkdirSync(outputDir, { recursive: true });
}

/**
 * Launch Chrome for pages of one size. The screencast only captures device
 * pixels (2x) when the window size matches the viewport.
 */
function launchBrowser(viewport) {
  return chromium.launch({
    channel: 'chrome',
    args: [
      '--force-device-scale-factor=2',
      `--window-size=${viewport.width},${viewport.height}`,
    ],
  });
}

let nextTerminalPort = 7700;

/** Start a writable ttyd terminal that runs bash in the demo repo. */
async function startTerminal({ env, fontSize }) {
  const port = nextTerminalPort++;
  const child = startProcess(
    'ttyd',
    [
      '-W',
      '-i',
      '127.0.0.1',
      '-p',
      String(port),
      '-t',
      `fontSize=${fontSize}`,
      '-t',
      "fontFamily='FiraCode Nerd Font Mono', Menlo, monospace",
      '-t',
      `theme=${JSON.stringify(terminalTheme)}`,
      '-t',
      'lineHeight=1.25',
      '-t',
      'cursorBlink=false',
      '-t',
      'disableLeaveAlert=true',
      '-t',
      'disableResizeOverlay=true',
      '-t',
      'titleFixed=notes',
      'bash',
      '--noprofile',
      '--norc',
      '-i',
    ],
    { cwd: demoDir, env },
  );
  await waitForUrl(`http://127.0.0.1:${port}/`);
  return { url: `http://127.0.0.1:${port}/`, stop: () => child.kill() };
}

async function openTerminalPage(browser, terminal, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await page.goto(terminal.url);
  await page.locator('.xterm-helper-textarea').waitFor({ state: 'attached' });
  // Add padding and hide the scroll bar, then let ttyd fit the terminal again.
  await page.addStyleTag({
    content: `
      html, body { background: ${terminalTheme.background} !important; }
      #terminal-container { position: absolute !important; inset: 16px 20px !important;
        width: auto !important; height: auto !important; }
      .xterm-viewport { overflow-y: hidden !important; }
    `,
  });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.locator('.xterm-screen').click();
  await sleep(800);
  // Start on an empty screen.
  await page.keyboard.press('Control+L');
  await sleep(400);
  return page;
}

async function typeCommand(page, command, { pauseAfterMs = 1800 } = {}) {
  await page.keyboard.type(command, { delay: 38 });
  await sleep(350);
  await page.keyboard.press('Enter');
  await sleep(pauseAfterMs);
}

async function openWebPage(browser, viewport, { cursor }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  if (cursor) await context.addInitScript(cursorScript);
  const page = await context.newPage();
  await page.goto(webUrl);
  await page.getByRole('heading', { name: 'Issues' }).waitFor();
  await sleep(500);
  return page;
}

/** A person writes a new issue and reprioritizes another one in the web UI. */
async function recordAuthor() {
  const viewport = { width: 1120, height: 660 };
  const browser = await launchBrowser(viewport);
  const page = await openWebPage(browser, viewport, { cursor: true });
  const mouse = createMouse(page);
  await mouse.moveTo(560, 420, 0);
  const capture = await startScreenCapture(page, join(outputDir, 'author.mp4'));
  await sleep(1200);

  await mouse.click(page.getByText('+ New Issue'));
  const dialog = page.getByRole('dialog', { name: 'Create new issue' });
  await dialog.waitFor();
  await sleep(500);
  await page.keyboard.type('Search should ignore case', { delay: 55 });
  await sleep(400);
  await mouse.click(dialog.locator('.ProseMirror'));
  await page.keyboard.type('Searching for "milk" does not find "Buy Milk".', {
    delay: 32,
  });
  await sleep(500);

  const pills = dialog.locator('form .relative.inline-block');
  await mouse.click(pills.nth(1));
  await sleep(450);
  await mouse.click(
    dialog.getByRole('button', { name: 'Urgent', exact: true }),
  );
  await sleep(450);
  await mouse.click(dialog.getByText('Label', { exact: true }));
  await sleep(450);
  await mouse.click(dialog.getByRole('button', { name: 'bug' }).first());
  await sleep(400);
  await mouse.click(dialog.getByRole('button', { name: 'Create Issue' }));
  await page.waitForURL(/\/issues\/5$/);
  await sleep(1500);

  await mouse.click(page.getByRole('link', { name: 'Issues', exact: true }));
  await page.getByRole('heading', { name: 'Issues' }).waitFor();
  await sleep(900);
  await mouse.click(page.getByText('Pages show one note too few'));
  await page.waitForURL(/\/issues\/1$/);
  await sleep(900);
  const priorityBadge = page
    .locator('aside, div')
    .getByRole('button', { name: 'Medium' })
    .last();
  await mouse.click(priorityBadge);
  await sleep(450);
  await mouse.click(page.getByRole('button', { name: 'High', exact: true }));
  await sleep(1200);

  await mouse.click(page.getByRole('link', { name: 'Issues', exact: true }));
  await page.getByRole('heading', { name: 'Issues' }).waitFor();
  await sleep(700);
  await mouse.click(page.getByRole('columnheader', { name: /Priority/ }));
  await sleep(500);
  await mouse.moveTo(700, 560, 700);
  await sleep(2200);
  const { duration } = await capture.stop();
  await browser.close();
  return { duration };
}

/** The CLI shows the same issues, and every change is a commit. */
async function recordFiles() {
  // Wide enough for the 106 columns of `gitrac list`.
  const viewport = { width: 1300, height: 700 };
  const terminal = await startTerminal({ env: baseEnv, fontSize: 18 });
  const browser = await launchBrowser(viewport);
  try {
    const page = await openTerminalPage(browser, terminal, viewport);
    const capture = await startScreenCapture(
      page,
      join(outputDir, 'files.mp4'),
    );
    await sleep(800);
    await typeCommand(page, 'gitrac list --sort priority', {
      pauseAfterMs: 2400,
    });
    await typeCommand(page, 'gitrac show 5', { pauseAfterMs: 2800 });
    await typeCommand(page, 'git log --oneline -3', { pauseAfterMs: 2800 });
    const { duration } = await capture.stop();
    return { duration };
  } finally {
    await browser.close();
    terminal.stop();
  }
}

function closedIssueIds() {
  const closedDir = join(demoDir, '.issues', 'closed');
  if (!existsSync(closedDir)) return [];
  return readdirSync(closedDir)
    .map((name) => Number.parseInt(name, 10))
    .filter(Number.isFinite);
}

function workTreeIsClean() {
  return run('git', ['status', '--porcelain'], { cwd: demoDir }).trim() === '';
}

/**
 * A coding agent works through the ready issues. The web UI and the agent's
 * terminal are recorded at the same time; `offset` is the start of the web
 * recording relative to the terminal recording, in seconds.
 */
async function recordAgent() {
  const expectedClosed = [1, 2, 5];
  const terminalViewport = { width: 880, height: 680 };
  const webViewport = { width: 1040, height: 680 };
  const terminal = await startTerminal({ env: agentEnv, fontSize: 15 });
  const terminalBrowser = await launchBrowser(terminalViewport);
  const webBrowser = await launchBrowser(webViewport);
  try {
    const web = await openWebPage(webBrowser, webViewport, { cursor: false });
    await web.locator('select').first().selectOption('all');
    await web.getByRole('columnheader', { name: /Priority/ }).click();
    await sleep(500);
    const shell = await openTerminalPage(
      terminalBrowser,
      terminal,
      terminalViewport,
    );

    const terminalCapture = await startScreenCapture(
      shell,
      join(outputDir, 'agent-terminal.mp4'),
    );
    const webCapture = await startScreenCapture(
      web,
      join(outputDir, 'agent-web.mp4'),
    );
    const offset = terminalCapture.elapsed() - webCapture.elapsed();
    const events = [];
    await sleep(800);
    await typeCommand(shell, 'pi', { pauseAfterMs: 2500 });
    events.push({ name: 'prompt', at: terminalCapture.elapsed() });
    await shell.keyboard.type('Work through the ready issues.', { delay: 45 });
    await sleep(400);
    await shell.keyboard.press('Enter');

    const deadline = Date.now() + 8 * 60 * 1000;
    const seen = new Set();
    while (Date.now() < deadline) {
      for (const id of closedIssueIds()) {
        if (!seen.has(id)) {
          seen.add(id);
          events.push({ name: `closed #${id}`, at: terminalCapture.elapsed() });
        }
      }
      if (expectedClosed.every((id) => seen.has(id)) && workTreeIsClean())
        break;
      await sleep(500);
    }
    if (!expectedClosed.every((id) => seen.has(id))) {
      throw new Error(
        `The agent did not close ${expectedClosed.join(', ')} in time`,
      );
    }
    events.push({ name: 'done', at: terminalCapture.elapsed() });
    // Let the agent print its summary.
    await sleep(15000);
    const terminalResult = await terminalCapture.stop();
    const webResult = await webCapture.stop();
    return { offset, events, terminal: terminalResult, web: webResult };
  } finally {
    await terminalBrowser.close();
    await webBrowser.close();
    terminal.stop();
  }
}

/** The fix and the closed issue land in the same commit. */
async function recordCommit() {
  const viewport = { width: 1000, height: 560 };
  const terminal = await startTerminal({ env: baseEnv, fontSize: 19 });
  const browser = await launchBrowser(viewport);
  try {
    const page = await openTerminalPage(browser, terminal, viewport);
    const capture = await startScreenCapture(
      page,
      join(outputDir, 'commit.mp4'),
    );
    await sleep(800);
    await typeCommand(page, 'git log --oneline -6', { pauseAfterMs: 2400 });
    const fixCommit = run('git', ['log', '--format=%h', '-1', '--grep=(#5)$'], {
      cwd: demoDir,
    }).trim();
    const changedFiles = run(
      'git',
      ['show', '--name-only', '--format=', fixCommit],
      { cwd: demoDir },
    );
    if (
      !changedFiles.includes('.issues/closed/5-') ||
      !changedFiles.includes('src/')
    ) {
      throw new Error(
        `Commit "${fixCommit}" does not contain both the fix and the closed #5`,
      );
    }
    await typeCommand(page, `git show --stat --format='%h %s' ${fixCommit}`, {
      pauseAfterMs: 3500,
    });
    const { duration } = await capture.stop();
    return { duration };
  } finally {
    await browser.close();
    terminal.stop();
  }
}

const recorders = {
  author: recordAuthor,
  files: recordFiles,
  agent: recordAgent,
  commit: recordCommit,
};

prepareWorkDir();
if (scenes.includes('author')) {
  run(join(import.meta.dirname, 'setup-demo.sh'), [demoDir], {
    stdio: 'inherit',
  });
}
const server = startProcess('gitrac', ['serve', '-p', String(webPort)], {
  cwd: demoDir,
  env: baseEnv,
});
try {
  await waitForUrl(webUrl);
  for (const scene of scenes) {
    console.log(`Recording ${scene}...`);
    const result = await recorders[scene]();
    const metadataFile = join(outputDir, `${scene}.json`);
    mkdirSync(dirname(metadataFile), { recursive: true });
    writeFileSync(metadataFile, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`  ${JSON.stringify(result)}`);
  }
} finally {
  server.kill();
}
