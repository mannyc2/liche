# @lili/releases

Release manifests, package renderers, artifact verification, official-flow handoffs, publish planning, and yank planning for Lili CLIs.

Use `@lili/releases` after `@lili/build` has produced a build record and final binary bytes. The release package validates the manifest, verifies binary bytes, renders package-manager artifacts, verifies package artifacts, and creates dry-run publisher plans.

```ts
import { parseCliReleaseManifest } from "@lili/releases";

const parsed = parseCliReleaseManifest({
  manifestVersion: 1,
  metadata: { description: "A Bun-native CLI." },
  subject: {
    id: "shipyard",
    name: "Shipyard",
    version: "0.1.0",
    commit: "0000000",
    contract: { kind: "core-command-manifest", digest: "sha256:example" },
  },
  release: {
    version: "0.1.0",
    createdAt: new Date().toISOString(),
    generatorVersion: "0.0.0",
  },
  runtime: { command: "shipyard" },
  binaries: [],
  packages: [],
});

if (!parsed.ok) throw parsed.error;
console.log(parsed.manifest.subject.id);
```

## CLI

```sh
li-release package ./dist/build-record.json --out ./dist/release --json
li-release publish ./dist/release/manifest.json --ecosystems npm --dry-run --json
```

## Renderer Subpaths

Concrete renderers are public subpath exports so integrations can load one ecosystem at a time.

```ts
import { npmRenderer } from "@lili/releases/renderers/npm";
```

`@lili/releases/renderers/all` exports `createDefaultRendererRegistry()` for npm, PyPI, Homebrew, and Scoop together. `@lili/releases/publishers` exports publisher planning, preflight, credential loading, and execution helpers.

Publishing remains aligned with official package-manager flows. CI should consume the release handoff artifacts rather than reconstruct package order or release intent in workflow YAML.
