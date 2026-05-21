# @lili/build

Build and compile planning primitives for Bun-native Lili CLIs.

Use `@lili/build` when you need deterministic Bun compile plans, compile flag profiles, target resolution, path-independent compile digests, and build records that release tooling can consume.

```ts
import { createCompilePlan } from "@lili/build";

const plan = createCompilePlan({
  entrypoint: "src/cli.ts",
  outfile: "dist/shipyard",
  target: "bun-darwin-arm64",
  constants: {
    buildToolVersion: "0.0.0",
    contractDigest: "sha256:example",
    releaseVersion: "0.1.0",
    sourceCommit: "0000000",
  },
});

console.log(plan.compileFlagsDigest);
```

## CLI

`li-build` wraps the same primitives for repositories that want a command-line build step.

```sh
li-build build ./src/cli.ts \
  --targets native \
  --release-version 0.1.0 \
  --commit 0000000 \
  --contract-digest sha256:example \
  --out ./dist/bin \
  --record ./dist/build-record.json \
  --json
```

`@lili/build` owns `Bun.build()` and compile facts. `@lili/releases` consumes build records and final binary bytes; it does not rebuild binaries.
