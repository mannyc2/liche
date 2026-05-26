# Release and distribution

This document defines the release-renderer architecture inside `@liche/releases`, the public release metadata rules, the manual publish path, and versioning policy.

See [distribution.md](./distribution.md) for the release manifest schema, [npm-binary-packaging.md](./npm-binary-packaging.md) for npm package shim details, and [coverage.md](./coverage.md) for the RELEASE-* coverage rows.

## Renderer architecture

All first-party release renderers live in `@liche/releases`. There is no `@liche/release-extra` package. npm is one renderer, not the privileged package boundary. Users choose zero to all renderers through release configuration.

### Renderer selection

Release configuration must support:

```txt
renderers: []
renderers: ["npm"]
renderers: ["pypi", "homebrew"]
renderers: "all"
```

`renderers: []` means manifest and final-binary verification only. It is valid for users who want to upload binaries manually or test release guard rails before publishing package-manager wrappers.

`renderers: "all"` means every implemented renderer whose required manifest metadata and renderer configuration are available. Missing required metadata for a selected renderer is a release error before staging artifacts. Missing metadata for an unselected renderer is ignored.

Renderer selection never checks registry credentials. Publishing automation has a separate publisher selection and preflight step after artifacts are rendered and verified.

The shared registry and selection API lives in `packages/releases/src/renderers/index.ts`. Concrete renderers live behind subpaths: `packages/releases/src/renderers/npm.ts`, `pypi.ts`, `homebrew.ts`, and `scoop.ts`. `packages/releases/src/renderers/all.ts` imports all four only for callers that ask for the all-renderer registry. Tests render all four ecosystems from one manifest without privileging npm.

### Package boundary

`@liche/releases` owns:

- release manifest schema
- shared renderer interface
- renderer registry and selection
- binary provenance and final byte verification
- staged package rendering
- final package artifact verification
- npm renderer
- PyPI renderer
- Homebrew renderer
- Scoop renderer
- future WinGet helper flow when explicitly in scope
- manifest-based yank and rollback planning

Renderer dependencies must stay out of `@liche/core`, `@liche/build`, and `@liche/product`. If an ecosystem needs heavyweight tooling, load or invoke it only when that renderer is selected; do not create another first-party release package to hide the dependency problem.

Renderer implementations must stay behind renderer subpath exports so users who only need the manifest/package spine do not import every ecosystem renderer. Publisher adapters also live in `@liche/releases`, but they are not renderers. A publisher consumes one release manifest plus verified package artifact records and then mutates npm, PyPI, tap, bucket, or other registry state. Publisher dependencies and credential handling must stay behind publisher subpaths and publisher selection.

The implemented package orchestration API is `packageRelease(...)`. It consumes manifest input plus explicit final binary paths, invokes selected renderers with only `{ manifest, binaries, outDir, config? }`, and verifies final package artifact bytes through package records. It does not rebuild binaries, reread Product/build source, or publish to registries.

### Renderer purity

Pure renderers need product metadata in the release manifest.

Required additive manifest section:

```ts
metadata: z.object({
  description: z.string(),
  homepage: z.string().url().optional(),
  license: z.string().optional(),
  repository: z
    .object({
      type: z.string(),
      url: z.string(),
    })
    .optional(),
  executable: z
    .object({
      title: z.string().optional(),
      publisher: z.string().optional(),
      copyright: z.string().optional(),
    })
    .optional(),
});
```

Renderers must not read `package.json`, product schema source, git config, generated source, or build output directories to recover metadata. The manifest is the renderer contract.

## Ecosystem renderers

### npm

Renderer shape:

```txt
umbrella package
  optionalDependencies on platform packages
platform package
  os/cpu/libc filters
  exactly one binary
  no install scripts
```

Guard rails:

```txt
npm/pack-created
npm/no-scripts
npm/version-skew
npm/platform-fields
npm/one-binary
npm/hash
npm/shim-actionable-error
npm/no-download
```

Detailed npm package JSON and shim behavior lives in [npm-binary-packaging.md](./npm-binary-packaging.md).

### PyPI

Renderer shape:

```txt
wheel per platform
binary placed in {distribution}-{version}.data/scripts/
wrapper exposes the intended command for pipx and script installs
RECORD hashes verified after wheel build
```

Linux tag decisions:

- glibc targets map to `manylinux` decisions
- musl targets map to `musllinux` decisions
- wheel filenames must use normalized distribution and version components
- wheel `RECORD` must hash every file except `RECORD` itself with sha256 or stronger
- wheel metadata must not rely on local package workspace state

Guard rails:

```txt
pypi/platform-tag
pypi/record-hashes
pypi/one-binary
pypi/pipx-entry
pypi/no-download
pypi/final-wheel-hash
pypi/metadata
```

### Homebrew

Renderer shape:

```txt
formula with macOS/Linux and architecture branches
url + sha256 from manifest
install copies one binary into bin
test do runs a real command
```

The formula may use `on_macos`, `on_linux`, and architecture helpers to select the binary URL and hash. Every branch must map to exactly one manifest binary. The renderer must not read local build output or infer URLs from GitHub release conventions.

Guard rails:

```txt
homebrew/sha
homebrew/platform-branch
homebrew/install-one-binary
homebrew/test
homebrew/no-stage-leak
homebrew/final-formula-matches-manifest
homebrew/no-scripted-download
```

### Scoop

Renderer shape:

```txt
JSON manifest
architecture map
url + hash from manifest
bin command declaration
```

The manifest must include version, description, homepage, license, architecture-specific URL/hash entries when needed, and `bin` entries for the installed command. Scoop supports pre/post install scripts, but this renderer must not emit them unless a later requirement explicitly approves a specific use case.

Guard rails:

```txt
scoop/hash
scoop/architecture-map
scoop/bin
scoop/no-install-scripts
scoop/final-json-matches-manifest
```

### WinGet

WinGet is planned but must not block the initial `@liche/releases` package. It usually requires a repository PR workflow and should be treated as an asynchronous release follow-up unless explicitly prioritized.

## Versioning policy

Keep the package suite pre-`1.0.0` until there is enough downstream use to freeze the public API and generated workflow. The current low version line is intentional; do not jump to `1.0.0` just because the first public package lane exists.

Rules:

- Use synchronized versions across all public packages by default. This keeps examples, package-to-package dependency ranges, generated-tool constants, and release troubleshooting simple.
- Treat `0.x` minor bumps as the breaking-change lane. Public API removals, generated output contract changes, command behavior changes, or a repo-wide generated release CLI should move from `0.5.x` to `0.6.0`.
- Treat `0.x` patch bumps as the compatible lane. Documentation fixes, metadata fixes, test-only hardening, internal refactors, and bug fixes that preserve public imports and command behavior should move from `0.5.0` to `0.5.1`.
- Use prerelease suffixes only for intentionally unstable public artifacts, for example `0.5.0-rc.1`. Do not use a prerelease suffix for normal manual patch releases.
- Keep package dependencies on matching caret ranges, such as `@liche/core: ^0.5.1`, after each synchronized bump.

Manual bump checklist:

- Update all package `version` fields.
- Update package-to-package `@liche/*` dependency ranges.
- Update tool version constants in `packages/build/src/cli.ts`, `packages/product/src/cli.ts`, `packages/releases/src/cli.ts`, and generated release config defaults.
- Update checked examples that pin public package versions.
- Update package-readiness tests that assert the public package version.
- Run `bun run release:check`, then `bun run --silent release:names`.

A repo-wide Liche CLI generated through `@liche/product` and released through `@liche/releases` is the kind of change that earns a minor bump.

## Automated npm publish path

Publishing through npm trusted publishing is tag-driven. The workflow uses npm's official `npm publish` command with GitHub Actions OIDC, not a long-lived npm token.

Release order:

1. Choose the next synchronized version using the versioning policy.
2. Apply the manual bump checklist.
3. Run `bun run release:check`.
4. Run `bun run --silent release:names`.
5. Create and push a matching tag, for example `git tag v0.5.1 && git push origin v0.5.1`.
6. The publish workflow validates that the tag version matches every public package version, verifies the versions are not already published, and publishes packages in dependency order: `@liche/core`, extension leaf packages, `@liche/agents`, `@liche/extensions`, `@liche/build`, `@liche/releases`, `@liche/product`.
7. Re-run `bun run --silent release:names` and verify every package reports the new version.

The same workflow keeps a manual `workflow_dispatch` dry-run path for CI validation and emergency release operations. Manual dispatch defaults to `dry_run=true`; tag pushes publish by default.

New public package names need one bootstrap publish before trusted publishing can own them. npm trusted-publisher configuration is package-scoped, so the trusted-publisher registry API and the npmjs.com package settings require the package to already exist on the registry. To avoid UI setup, run `bun run release:bootstrap-names` from an authenticated npm session; it publishes only missing package names at `0.0.0-bootstrap.0` with the `bootstrap` dist-tag from temporary package copies. Then run `bun run release:trust` to configure trusted publishing for `mannyc2/liche`, `publish.yml`, `npm-production`, and the `npm publish` allowed action. After that, use the tag workflow for synchronized releases.

## Package metadata rule

Every publishable package must set `repository.url` to `https://github.com/mannyc2/liche.git` and `repository.directory` to its package directory. Do not add homepage, bugs, or funding metadata until the canonical public URLs are real. Placeholder metadata is worse than absence because npm trusted publishing checks package repository metadata during GitHub-based publication.

Before the first public publish:

- root workspace stays private
- every publishable package declares `license: "MIT"`
- every publishable package ships `README.md` and `LICENSE`
- every publishable package keeps `publishConfig.access = "public"`
- package-to-package `@liche/*` dependencies use the synchronized public version range
- `repository.url` and `repository.directory` match the trusted-publishing repository and package directory
- homepage, bugs, and funding fields are either real or absent

The offline check is:

```bash
bun run --silent release:metadata
```

## Trusted publishing

npm trusted publishing uses OIDC to publish from CI without long-lived npm tokens. The current npm docs require npm CLI `11.5.1` or later and Node `22.14.0` or later for trusted publishing, and GitHub Actions configuration needs `id-token: write`. The npm trusted publisher settings must name the GitHub organization or user, repository, workflow filename, optional environment, and allowed action.

The release workflow committed in this repository is `.github/workflows/publish.yml`. It publishes on pushed `v*` tags, keeps a manual `workflow_dispatch` dry-run path, uses GitHub-hosted Ubuntu runners, Node 24, Bun 1.3.0, npm 11.10+, `id-token: write`, disabled package-manager caching, and the GitHub environment `npm-production`.

Trusted publishing is not the first-package creation path for npm: trusted-publisher configuration requires the package to already exist on the registry, and the npm website configures trusted publishers from package settings. `bun run release:trust` uses the registry API directly so it can send the current allowed-action permission payload. To set up trusted publishing for new packages:

1. Create the npm organization for the package scope.
2. Align package names, imports, docs, and release checks with that scope.
3. Publish the first public versions with an interactive owner account or a short-lived bootstrap token.
4. Configure each package's trusted publisher to use GitHub Actions:
   - GitHub organization/user: repository owner
   - Repository: repository name
   - Workflow filename: `publish.yml`
   - Environment name: `npm-production`
   - Allowed action: `npm publish`
5. After the trusted publisher is verified, restrict package publishing to require 2FA and disallow traditional tokens.

For npm:

- use GitHub-hosted runners for the trusted-publishing path
- set job permissions to `id-token: write` and `contents: read`
- configure trusted publishers for each npm package
- select `npm publish` as an allowed action
- keep `repository.url` exactly aligned with the final GitHub repository before enabling trusted publishing
- use token publishing only for the first-package bootstrap or as an explicit emergency fallback

PyPI trusted publishing also uses OIDC. The PyPI docs recommend `pypa/gh-action-pypi-publish` for the stable public interface, with job-level `id-token: write`; the manual OIDC token exchange is documented as implementation-specific and not the preferred user path.

For PyPI:

- use a protected publishing environment
- set job-level `id-token: write`
- publish through `pypa/gh-action-pypi-publish`
- keep the local `twine` token executor as a fallback path only
- keep PyPI trusted-publisher/OIDC execution as an official workflow handoff, not a custom local token exchange

References:

- npm trusted publishing: https://docs.npmjs.com/trusted-publishers/
- npm provenance: https://docs.npmjs.com/generating-provenance-statements/
- PyPI trusted publishers: https://docs.pypi.org/trusted-publishers/
- PyPI trusted publisher usage: https://docs.pypi.org/trusted-publishers/using-a-publisher/

## Artifact layout and checksums

Every release candidate must have one release directory with these classes of artifacts:

```txt
release/
  manifest.json
  build-record.json
  checksums.sha256
  binaries/
    <command>-<target>
  packages/
    npm/
    pypi/
    homebrew/
    scoop/
  receipts/
    publish-plan.json
    publish-preflight.json
    publish-dry-run.json
```

Rules:

- `manifest.json` is the release contract.
- `build-record.json` records compile inputs and final binary facts.
- `checksums.sha256` is derived from the final files in the release directory.
- binary `sha256` and `size` values must match the final signed or notarized bytes.
- package artifact `sha256` and `size` values must match the files that will be uploaded or committed.
- GitHub release assets must match the manifest records and `checksums.sha256`.
- registry or repository attestations do not replace local sha256 checks.

## Local release gate

The local gate is:

```bash
bun run release:check
```

It runs workspace checks, package tests, example smokes, metrics, offline metadata checks, and whitespace diff checks. It intentionally does not publish packages or require network access.
