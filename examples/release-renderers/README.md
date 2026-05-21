# Release renderers example

This example shows `@lili/releases` consuming a build record and verified final binary bytes to render package-manager artifacts. The fixture binary is just a tiny file; renderers verify bytes and package wrappers, they do not execute it.

Run the packaging command from the repository root:

```sh
bun packages/releases/src/cli.ts package examples/release-renderers/build-record.json \
  --config examples/release-renderers/lili.releases.json \
  --out examples/release-renderers/.tmp/release \
  --json
```

The output directory will contain one `manifest.json`, copied release binaries under `.tmp/release/binaries`, and npm package directories and tarballs under `.tmp/release/packages/npm`.
