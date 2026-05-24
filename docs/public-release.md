# Public Release And Versioning

This document defines public release metadata, manual publishing, and package versioning rules. The old "v1" label is a release-readiness milestone, not a requirement to publish `1.0.0`.

## Current Registry Fact

Checked on 2026-05-24 with:

```bash
npm view @liche/core version --json
npm view @liche/extensions version --json
npm view @liche/build version --json
npm view @liche/product version --json
npm view @liche/releases version --json
```

The public npm registry returned `0.4.0` for all five packages. The first public npm bootstrap is complete for:

- `@liche/core`
- `@liche/extensions`
- `@liche/build`
- `@liche/product`
- `@liche/releases`

Operational publication still requires:

- `npm whoami` under the publishing account before manual publishes
- confirmed membership or ownership for the `@liche` npm organization
- package publish rights for `@liche/core`, `@liche/extensions`, `@liche/build`, `@liche/product`, and `@liche/releases`
- trusted publisher configuration before relying on the final CI release workflow

The repeatable live check is:

```bash
bun run --silent release:names
```

## Versioning Policy

Keep the package suite pre-`1.0.0` until there is enough downstream use to freeze the public API and generated workflow. The current low version line is intentional; do not jump to `1.0.0` just because the first public package lane exists.

Rules:

- Use synchronized versions across all five packages by default. This keeps examples, package-to-package dependency ranges, generated-tool constants, and release troubleshooting simple.
- Treat `0.x` minor bumps as the breaking-change lane. Public API removals, generated output contract changes, command behavior changes, or a repo-wide generated release CLI should move from `0.4.x` to `0.5.0`.
- Treat `0.x` patch bumps as the compatible lane. Documentation fixes, metadata fixes, test-only hardening, internal refactors, and bug fixes that preserve public imports and command behavior should move from `0.4.0` to `0.4.1`.
- Use prerelease suffixes only for intentionally unstable public artifacts, for example `0.4.0-rc.1`. Do not use a prerelease suffix for normal manual patch releases.
- Keep package dependencies on matching caret ranges, such as `@liche/core: ^0.4.1`, after each synchronized bump.

Manual bump checklist:

- Update all package `version` fields.
- Update package-to-package `@liche/*` dependency ranges.
- Update tool version constants in `packages/build/src/cli.ts`, `packages/product/src/cli.ts`, `packages/releases/src/cli.ts`, and generated release config defaults.
- Update checked examples that pin public package versions.
- Update package-readiness tests that assert the public package version.
- Run `bun run release:check`, then `bun run --silent release:names`.

The next normal maintenance release after this hard cutover should be `0.4.1`. A repo-wide Liche CLI that is generated through `@liche/product` and released through `@liche/releases` is large enough for the next minor line.

## Manual Publish Path

Publishing remains manual for now. Use the local checks and npm's official publishing path rather than adding custom version automation in this slice.

Manual release order:

1. Choose the next synchronized version using the versioning policy.
2. Apply the manual bump checklist.
3. Run `bun run release:check`.
4. Run `bun run --silent release:names`.
5. Publish packages in dependency order: `@liche/core`, `@liche/extensions`, `@liche/build`, `@liche/releases`, `@liche/product`.
6. Re-run `bun run --silent release:names` and verify every package reports the new version.

The committed `.github/workflows/publish.yml` is the intended CI path once trusted publishing is configured, but manual publishing stays the source of truth until that credential path is proven.

## Package Metadata Rule

Do not add repository, homepage, bugs, or funding metadata until the canonical public URLs are real. Placeholder metadata is worse than absence because npm trusted publishing checks package repository metadata during GitHub-based publication.

Before the first public publish:

- root workspace stays private
- every publishable package declares `license: "MIT"`
- every publishable package ships `README.md` and `LICENSE`
- every publishable package keeps `publishConfig.access = "public"`
- package-to-package `@liche/*` dependencies use the synchronized public version range
- repository, homepage, bugs, and funding fields are either real or absent

The offline check is:

```bash
bun run --silent release:metadata
```

## Trusted Publishing

npm trusted publishing uses OIDC to publish from CI without long-lived npm tokens. The current npm docs require npm CLI `11.5.1` or later and Node `22.14.0` or later for trusted publishing, and GitHub Actions configuration needs `id-token: write`. The npm trusted publisher settings must name the GitHub organization or user, repository, workflow filename, optional environment, and allowed action.

The release workflow committed in this repository is:

```txt
.github/workflows/publish.yml
```

It uses a manual `workflow_dispatch` trigger, a `dry_run` input that defaults to `true`, GitHub-hosted Ubuntu runners, Node 24, Bun 1.3.0, npm 11.10+, `id-token: write`, disabled package-manager caching, and the GitHub environment `npm-production`.

Trusted publishing is not the first-package creation path for npm. The npm CLI `npm trust` command requires the package to already exist on the registry, and the npm website configures trusted publishers from package settings. Therefore the bootstrap order is:

1. Create the npm organization for the final scope.
2. Hard-cut package names, imports, docs, and release checks to that scope.
3. Publish the first public versions with an interactive owner account or a short-lived bootstrap token.
4. Configure each package's trusted publisher to use GitHub Actions:
   - GitHub organization/user: final repository owner
   - Repository: final repository name
   - Workflow filename: `publish.yml`
   - Environment name: `npm-production`
   - Allowed action: `npm publish`
5. Restrict package publishing access to require 2FA and disallow traditional tokens after the trusted publisher is verified.

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

## Artifact Layout And Checksums

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

## Local Release Gate

The local gate is:

```bash
bun run release:check
```

It runs workspace checks, package tests, example smokes, metrics, offline metadata checks, and whitespace diff checks. It intentionally does not publish packages or require network access.
