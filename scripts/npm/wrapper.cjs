#!/usr/bin/env node

// This script is the entry point for the @gitrac/cli npm package.
// It resolves and spawns the correct platform-specific binary from
// the @gitrac/cli-{os}-{arch} optional dependency packages.

const { platform, arch, env, argv } = process;
const { spawnSync } = require('node:child_process');

const PLATFORMS = {
  darwin: {
    arm64: '@gitrac/cli-darwin-arm64/bin/gitrac',
  },
  linux: {
    x64: '@gitrac/cli-linux-x64/bin/gitrac',
    arm64: '@gitrac/cli-linux-arm64/bin/gitrac',
  },
};

const binPath = env.GITRAC_BINARY || PLATFORMS[platform]?.[arch];

if (!binPath) {
  console.error(
    `gitrac does not ship prebuilt binaries for your platform (${platform}-${arch}).`,
  );
  console.error(
    'You can install from source instead: https://github.com/murrayju/gitrac',
  );
  process.exitCode = 1;
} else {
  let resolvedPath;
  try {
    resolvedPath = env.GITRAC_BINARY || require.resolve(binPath);
  } catch {
    console.error(
      `Could not find the gitrac binary for your platform (${platform}-${arch}).`,
    );
    console.error(
      'The platform-specific package may not have been installed correctly.',
    );
    console.error('Try reinstalling: npm install -g @gitrac/cli');
    process.exitCode = 1;
  }

  if (resolvedPath) {
    const result = spawnSync(resolvedPath, argv.slice(2), {
      shell: false,
      stdio: 'inherit',
    });

    if (result.error) {
      throw result.error;
    }

    // Mirror a signal-terminated child (e.g. Ctrl-C on `gitrac serve`)
    if (result.signal) {
      process.kill(process.pid, result.signal);
    }

    process.exitCode = result.status ?? 1;
  }
}
