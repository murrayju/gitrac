#!/usr/bin/env bun

// ============================================================================
// Build Script - Two-phase build for gitrac
//
// Phase 1: Build the React SPA with Vite (outputs to dist/ui/)
// Phase 2: Compile the CLI into a single binary with bun build --compile
//
// Usage:
//   ./bun run scripts/build.ts
//   ./bun run scripts/build.ts --outfile=./bin/gitrac --minify --sourcemap
//   ./bun run scripts/build.ts --target=bun-linux-x64 --outfile=gitrac-linux-x64
// ============================================================================

import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    outfile: { type: 'string', default: './bin/gitrac' },
    target: { type: 'string' },
    minify: { type: 'boolean', default: false },
    sourcemap: { type: 'boolean', default: false },
    'skip-ui': { type: 'boolean', default: false },
  },
  strict: false,
  allowPositionals: true,
});

// Phase 1: Build the React SPA with Vite
if (!values['skip-ui']) {
  console.log('Phase 1: Building UI with Vite...');
  const vite = Bun.spawn(
    ['./bun', 'run', 'vite', 'build', '--config', 'vite.config.ts'],
    {
      stdio: ['inherit', 'inherit', 'inherit'],
    },
  );
  const viteExitCode = await vite.exited;
  if (viteExitCode !== 0) {
    console.error('Vite build failed');
    process.exit(viteExitCode);
  }
  console.log('UI build complete.\n');
}

// Phase 2: Compile the CLI binary
console.log('Phase 2: Compiling binary...');
const args = [
  'build',
  './index.ts',
  '--compile',
  `--outfile=${values.outfile}`,
];

if (values.minify) args.push('--minify');
if (values.sourcemap) args.push('--sourcemap');
if (values.target) args.push(`--target=${values.target}`);

const proc = Bun.spawn(['./bun', ...args], {
  stdio: ['inherit', 'inherit', 'inherit'],
});
const exitCode = await proc.exited;

if (exitCode === 0) {
  console.log(`\nBinary built: ${values.outfile}`);
}

process.exit(exitCode);
