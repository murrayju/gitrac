# Releasing gitrac

How gitrac is built, released and distributed, plus the one-time setup for the install domain and npm. This setup mirrors the one used for [ox](https://github.com/timescale/ox).

## Distribution channels

| Channel | What users run | Source |
|---|---|---|
| Install script | `curl -fsSL https://get.gitrac.dev \| bash` | [`install.sh`](../install.sh), served by a Cloudflare redirect |
| npm | `npm install -g @gitrac/cli` | [`scripts/npm/`](../scripts/npm) |
| GitHub Releases | download `gitrac-<os>-<arch>` | [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) |

All three ship the same single-file binaries. They are built with `bun build --compile` and have the web UI embedded, for `linux-x64`, `linux-arm64` and `darwin-arm64`.

## Cutting a release

```bash
./bun run scripts/release.ts patch     # or minor | major | 1.2.3
```

The script:
1. checks that the tree is clean, you're on `main`, and you're up to date with `origin`;
2. bumps `package.json` (which `gitrac --version` reports);
3. commits `release: vX.Y.Z`, tags it, and pushes with `--follow-tags`.

The tag triggers **Publish** (`.github/workflows/publish.yml`):

1. **build**: compiles each platform binary on its native runner. The linux-x64 binary is smoke-tested with `--version`.
2. **release**: creates the GitHub Release with the raw binaries attached (`gitrac-linux-x64`, ...). `install.sh` downloads these from `releases/latest/download/…`.
3. **publish-npm**: `scripts/npm/publish.ts` generates and publishes four packages via npm trusted publishing (OIDC, no token):
   - `@gitrac/cli-linux-x64`, `@gitrac/cli-linux-arm64` and `@gitrac/cli-darwin-arm64` each contain one binary (`os`/`cpu` restricted).
   - `@gitrac/cli` is the entry point: [`wrapper.cjs`](../scripts/npm/wrapper.cjs) plus the three platform packages as `optionalDependencies`, so npm installs only the matching one.
   - Prerelease versions (`./bun run scripts/release.ts 0.3.0-rc.1`) are published under the `next` dist-tag (`npm i -g @gitrac/cli@next`), so they never become `latest`. The GitHub Release for a prerelease tag is marked as a prerelease too, so `releases/latest`, which `install.sh` uses, keeps pointing at the newest stable version. Install an RC with `GITRAC_VERSION=0.3.0-rc.1`.

To check the packages locally without publishing:

```bash
./bun scripts/npm/publish.ts --version 0.0.0-test --binaries-dir ./binaries --work-dir ./out --no-publish
# or have npm validate them:  ... --dry-run
```

Here `./binaries` holds `gitrac-linux-x64`, `gitrac-linux-arm64` and `gitrac-darwin-arm64`. You can cross-compile them with `./bun run scripts/build.ts --minify --target=bun-<os>-<arch> --outfile=binaries/gitrac-<os>-<arch>`.

---

## One-time setup

### 1. `get.gitrac.dev` (Cloudflare)

`get.gitrac.dev` doesn't host anything. It's a Cloudflare redirect to the script on `main`, the same as `get.ox.build`:

```console
$ curl -sI https://get.gitrac.dev
HTTP/2 301
location: https://raw.githubusercontent.com/murrayju/gitrac/main/install.sh
```

In the Cloudflare dashboard for the `gitrac.dev` zone:

1. **DNS → Records → Add record**
   - Type `AAAA`, Name `get`, IPv6 address `100::`, **Proxy status: Proxied** (orange cloud).
   - `100::` is the discard prefix. The record only exists so Cloudflare's proxy answers for the hostname, and requests never reach an origin. (`A` → `192.0.2.1`, proxied, works too.)
2. **Rules → Redirect Rules → Create rule** (Single Redirect)
   - Rule name: `get.gitrac.dev → install.sh`
   - When incoming requests match: **Custom filter expression**, Field `Hostname`, Operator `equals`, Value `get.gitrac.dev`. Equivalent expression: `(http.host eq "get.gitrac.dev")`.
   - Then: Type **Static**, URL `https://raw.githubusercontent.com/murrayju/gitrac/main/install.sh`, Status code **301**, *Preserve query string* off.
   - Deploy.
3. **SSL/TLS**: nothing to do. Universal SSL already covers first-level subdomains such as `get.gitrac.dev`. Make sure the zone's encryption mode isn't "Off".

Verify:

```bash
curl -sI https://get.gitrac.dev | grep -i location
curl -fsSL https://get.gitrac.dev | head -5            # should print the script header
```

Since it's a redirect to `main`, changes to `install.sh` go live as soon as they're merged; no deploy needed. Browsers may cache a `301` indefinitely. That doesn't matter for `curl`, but use `302` if you might change the target later.

### 2. npm: `@gitrac` packages and trusted publishing

CI publishes with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers): GitHub's OIDC token proves the publish came from this repo's workflow, so there's no `NPM_TOKEN` secret. A trusted publisher can only be attached to a package that already exists, so the **first** version of each of the four packages has to be published by hand:

1. **Cut the first release** (`./bun run scripts/release.ts minor`). The `build` and `release` jobs succeed. `publish-npm` **fails the first time**, because no trusted publisher is configured yet. That's expected.
2. **Publish that version from your machine** as an `@gitrac` org member:

   ```bash
   npm login                                            # account with publish rights on @gitrac
   gh release download v0.2.0 -R murrayju/gitrac -D ./binaries
   ./bun scripts/npm/publish.ts --version 0.2.0 --binaries-dir ./binaries
   ```

   This uses your `~/.npmrc` login. With 2FA, npm prompts for an OTP for each of the four packages. Platform packages are published first, then `@gitrac/cli`.
3. **Add the trusted publisher to each package.** On npmjs.com, for each of `@gitrac/cli`, `@gitrac/cli-linux-x64`, `@gitrac/cli-linux-arm64` and `@gitrac/cli-darwin-arm64`: **Settings → Trusted Publisher → GitHub Actions**:
   - Organization or user: `murrayju`
   - Repository: `gitrac`
   - Workflow filename: `publish.yml`
   - Environment: *(leave empty)*
4. **Optional hardening:** for each package, **Settings → Publishing access → "Require two-factor authentication and disallow tokens"**. Trusted publishing keeps working, and stolen tokens can't publish.
5. From the next release on, `publish-npm` publishes automatically, with provenance attestations.

Requirements the workflow already meets:
- `id-token: write` permission;
- npm ≥ 11.5.1 (run via `./bun x npm@>=11.5.1`);
- a `repository.url` in every generated `package.json` that matches `github.com/murrayju/gitrac`.

---

## Supported platforms

| Platform | Binary | npm package |
|---|---|---|
| Linux x64 | `gitrac-linux-x64` | `@gitrac/cli-linux-x64` |
| Linux arm64 | `gitrac-linux-arm64` | `@gitrac/cli-linux-arm64` |
| macOS arm64 (Apple Silicon) | `gitrac-darwin-arm64` | `@gitrac/cli-darwin-arm64` |

Adding a platform means updating the build matrix in `publish.yml`, `PLATFORMS` in `scripts/npm/publish.ts` and `wrapper.cjs`, the `case` blocks in `install.sh`, and this table. A new npm platform package also has to be bootstrapped as in step 2 above.
