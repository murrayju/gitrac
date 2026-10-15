---
id: 91
title: One-line install script (get.gitrac.dev) and npm package (@gitrac/cli)
status: done
priority: high
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-15T21:24:59.754Z'
createdBy: Justin Murray
updated: '2026-10-15T21:44:55.868Z'
---

Simplify installation, modeled closely on how ox does it (`~/dev/timescale/ox`: `install.sh`, `scripts/npm/`, the publish workflow).

## Acceptance criteria

- `install.sh` at the repo root:
  - detects OS/arch;
  - downloads the matching release binary to `~/.local/bin/gitrac` (pin with `GITRAC_VERSION`);
  - offers to add `~/.local/bin` to PATH;
  - verifies the install.

  Served at `curl -fsSL https://get.gitrac.dev | bash` via a Cloudflare redirect to the raw GitHub URL.
- Releases attach raw binaries (`gitrac-<os>-<arch>`) instead of tarballs.
- npm packages are published from the release workflow via npm trusted publishing (OIDC, no token):
  - `@gitrac/cli`: a JS wrapper with `optionalDependencies`;
  - `@gitrac/cli-linux-x64`, `@gitrac/cli-linux-arm64`, `@gitrac/cli-darwin-arm64`.
- Docs:
  - README install section;
  - a maintainer guide covering the one-time Cloudflare DNS + redirect rule setup and the npm org/trusted-publisher bootstrap.
- Tests: install script against a fake release, npm package generation, and the wrapper.

---

### Justin Murray — 2026-10-15T21:44:55.868Z

\## #91: One-line install script and npm packages

Modeled closely on ox (`install.sh`, `scripts/npm/`, the publish workflow).

**Install script (`install.sh`, served at `curl -fsSL https://get.gitrac.dev | bash`)**
- Detects OS/arch (linux x64/arm64, macOS arm64; a clear error for Intel Macs) and downloads the matching release binary to `~/.local/bin/gitrac`.
- Offers (via `/dev/tty`, so it works under `curl | bash`) to add the directory to PATH in `.zshrc`/`.bashrc`. It writes `$HOME/.local/bin` unexpanded and doesn't ask again if the rc file already has it.
- Verifies the binary runs and prints next steps.
- Options:
  - `GITRAC_VERSION` (with or without a leading `v`);
  - `GITRAC_INSTALL_DIR`;
  - `GITRAC_NONINTERACTIVE=1` (CI/Docker; never prompts or edits rc files).
- Differences from ox:
  - no shell completions (gitrac has none);
  - `/dev/tty` must actually be openable, not just exist;
  - a git presence warning.
- Kept shellcheck-clean; a CI step was added to `check.yml`.

**Releases (`.github/workflows/publish.yml`)**
- Release assets are now raw binaries (`gitrac-<os>-<arch>`) instead of tarballs, like ox. The linux-x64 binary is smoke-tested with `--version`.
- Prerelease tags (`v1.2.0-rc.1`) create GitHub prereleases, so `releases/latest` and therefore `install.sh` stay on stable.
- New `publish-npm` job uses npm trusted publishing (OIDC, `id-token: write`, no token).

**npm (`scripts/npm/publish.ts`, `scripts/npm/wrapper.cjs`)**
- Packages:
  - `@gitrac/cli-linux-x64`, `@gitrac/cli-linux-arm64`, `@gitrac/cli-darwin-arm64`: one binary each, restricted by `os`/`cpu`;
  - `@gitrac/cli`: a Node wrapper that resolves the platform package via `optionalDependencies`, plus the README.
- The wrapper forwards args, exit codes and signals; `GITRAC_BINARY` overrides the binary.
- Changes from ox:
  - prereleases are published under the `next` dist-tag (npm refuses untagged prereleases; found via a real `--dry-run`);
  - `--no-publish` / `--work-dir` generate packages offline (used by the tests);
  - generation is exported for tests.

**Docs**
- README install section: quick install, npm, manual download, from source.
- Skill installation section and AGENTS.md (structure + Releasing).
- New `docs/releasing.md`:
  - release flow;
  - the one-time Cloudflare setup (proxied `AAAA get → 100::` + a Single Redirect rule, 301 to `raw.githubusercontent.com/murrayju/gitrac/main/install.sh`, the same as `get.ox.build`);
  - the npm bootstrap. A trusted publisher can only be attached to an existing package, so the first version is published locally, then a trusted publisher is configured for each of the 4 packages.

**Verification**
- New tests:
  - `src/install-script.test.ts`: fake `curl` covering latest, pinned version, download failure, custom dir on PATH, rc already configured.
  - `src/npm-package.test.ts`: package contents, `--no-publish`, missing binary, dist-tags, wrapper resolution through a real `node_modules` layout, `GITRAC_BINARY`, missing platform package.
- Manual:
  - cross-compiled all three binaries;
  - `npm pack` + `npm install -g` of the tarballs into a temp prefix, then under real node: `--version`, `init`, `create`, exit code 5, `serve` serving the embedded UI, and SIGINT stopping both processes;
  - `install.sh` against the real binary, including the interactive prompt through a pty, both directly and as `cat install.sh | bash`;
  - `publish.ts --dry-run` against the real npm registry for stable and prerelease versions.
