# Public Release Metadata

This document closes the public release metadata rules for v1. It is a release-candidate gate, not a hosted-service plan.

## Current Registry Fact

Checked on 2026-05-24 with:

```bash
npm view @lili/core version --json
npm view @lili/build version --json
npm view @lili/product version --json
npm view @lili/releases version --json
```

The public npm registry returned `E404` for all four names. That means no public package was returned by the registry at check time. It does not prove ownership of the `@lili` organization or publish rights.

Final publication still requires:

- `npm whoami` under the publishing account
- confirmed membership or ownership for the `@lili` npm organization
- package creation rights for `@lili/core`, `@lili/build`, `@lili/product`, and `@lili/releases`
- trusted publisher configuration for the final release workflow

The repeatable live check is:

```bash
bun run --silent release:names
```

## Package Metadata Rule

Do not add repository, homepage, bugs, or funding metadata until the canonical public URLs are real. Placeholder metadata is worse than absence because npm trusted publishing checks package repository metadata during GitHub-based publication.

Before the first public publish:

- root workspace stays private
- every publishable package declares `license: "MIT"`
- every publishable package ships `README.md` and `LICENSE`
- every publishable package keeps `publishConfig.access = "public"`
- package-to-package `@lili/*` dependencies use the synchronized public version range
- repository, homepage, bugs, and funding fields are either real or absent

The offline check is:

```bash
bun run --silent release:metadata
```

## Trusted Publishing

npm trusted publishing uses OIDC to publish from CI without long-lived npm tokens. The current npm docs require npm CLI `11.5.1` or later and Node `22.14.0` or later for trusted publishing, and GitHub Actions configuration needs `id-token: write`. The npm trusted publisher settings must name the GitHub organization or user, repository, workflow filename, optional environment, and allowed action.

For npm:

- use GitHub-hosted runners for the trusted-publishing path
- set job permissions to `id-token: write` and `contents: read`
- configure trusted publishers for each npm package
- select `npm publish` as an allowed action
- keep `repository.url` exactly aligned with the final GitHub repository before enabling trusted publishing
- use token publishing only as an explicit fallback

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

## Local Release Candidate Gate

The local gate is:

```bash
bun run release:check
```

It runs workspace checks, package tests, example smokes, metrics, offline metadata checks, and whitespace diff checks. It intentionally does not publish packages or require network access.
