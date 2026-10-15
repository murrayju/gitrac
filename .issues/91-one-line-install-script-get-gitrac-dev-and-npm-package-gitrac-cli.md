---
id: 91
title: One-line install script (get.gitrac.dev) and npm package (@gitrac/cli)
status: todo
priority: high
assignee: ''
labels:
  - feature
created: '2026-10-15T21:24:59.754Z'
createdBy: Justin Murray
updated: '2026-10-15T21:24:59.754Z'
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
