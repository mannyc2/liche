# Changelog

This project follows one changelog for the synchronized first-party package suite:

- `@liche/core`
- `@liche/product`
- `@liche/build`
- `@liche/releases`

## Unreleased

### Added

- Local release-candidate gate through `bun run release:check`.
- Release-candidate metrics through `bun run --silent metrics`.
- Offline release metadata gate through `bun run --silent release:metadata`.
- Live npm package-name status probe through `bun run release:names`.
- Security, support, changelog, and package license artifacts for public release preparation.

### Release Policy

Before the first public v1 release, package versions remain synchronized. Public release notes must include:

- package versions
- release manifest path
- binary and package artifact checksums
- registry publish mode for each ecosystem
- known unsupported runtime targets
