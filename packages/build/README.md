# @liche/build

Build and compile planning primitives for Bun-native Liche CLIs.

This package is published as Bun-only TypeScript source. Use Bun `>= 1.3.0`; the current package format does not ship `dist` or declaration artifacts.

Use `@liche/build` when you need deterministic Bun compile plans, compile flag profiles, target resolution, path-independent compile digests, and build records that release tooling can consume.

```ts
import { createCompilePlan } from "@liche/build";

const plan = createCompilePlan({
  entrypoint: "src/cli.ts",
  outfile: "dist/shipyard",
  target: "bun-darwin-arm64",
  constants: {
    buildToolVersion: "0.5.0",
    contractDigest: "sha256:example",
    releaseVersion: "0.1.0",
    sourceCommit: "0000000",
  },
});

console.log(plan.compileFlagsDigest);
```

## CLI

`liche-build` wraps the same primitives for repositories that want a command-line build step.

```sh
liche-build build ./src/cli.ts \
  --targets native \
  --release-version 0.1.0 \
  --commit 0000000 \
  --contract-digest sha256:example \
  --out ./dist/bin \
  --record ./dist/build-record.json \
  --json
```

`@liche/build` owns `Bun.build()` and compile facts. `@liche/releases` consumes build records and final binary bytes; it does not rebuild binaries.
