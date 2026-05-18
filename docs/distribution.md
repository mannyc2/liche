# Distribution requirements

`@lili/releases` owns the distribution contract. It consumes final binary artifacts and produces a release manifest plus selected package-manager artifacts rendered from that manifest.

Package-manager wrappers are delivery mechanisms. The compiled binary is the product.

## Manifest invariant

The release manifest is the only contract between binary production and package-manager wrappers.

Renderers must be pure functions:

```txt
release manifest -> staged package artifact
```

Renderers must not read schema files, generated source, package workspaces, or build output directories except through manifest references.

Renderer selection and non-npm renderer requirements live in `docs/releases.md`.

Detailed npm packaging requirements live in `docs/npm-binary-packaging.md`.

## Manifest schema

Required shape:

```ts
import { z } from "zod";

export const CliReleaseManifest = z.object({
  manifestVersion: z.literal(1),

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
  }),

  schema: z.object({
    name: z.string(),
    version: z.string(),
    commit: z.string(),
    digest: z.string(),
  }),

  release: z.object({
    version: z.string(),
    channel: z.enum(["stable", "next", "canary"]).default("stable"),
    createdAt: z.string(),
    generatorVersion: z.string(),
    buildId: z.string().optional(),
  }),

  runtime: z.object({
    command: z.string(),
    env: z.array(
      z.object({
        name: z.string(),
        purpose: z.string(),
        required: z.boolean().default(false),
      }),
    ).default([]),
    config: z.array(
      z.object({
        key: z.string(),
        purpose: z.string(),
        required: z.boolean().default(false),
      }),
    ).default([]),
  }),

  conformance: z.object({
    required: z.boolean().default(false),
    report: z.string().optional(),
    checkedAt: z.string().optional(),
    target: z.string().optional(),
    schemaDigest: z.string().optional(),
  }).optional(),

  binaries: z.array(
    z.object({
      target: z.enum([
        "bun-darwin-arm64",
        "bun-darwin-x64",
        "bun-linux-arm64",
        "bun-linux-x64",
        "bun-linux-arm64-musl",
        "bun-linux-x64-musl",
        "bun-windows-x64",
        "bun-windows-arm64",
      ]),

      platform: z.enum(["darwin", "linux", "windows"]),
      arch: z.enum(["arm64", "x64"]),
      libc: z.enum(["glibc", "musl"]).optional(),

      url: z.string().url(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      size: z.number().int().positive(),

      signed: z.boolean().default(false),
      notarized: z.boolean().default(false),
    }),
  ),

  packages: z.object({
    npm: z.array(
      z.object({
        name: z.string(),
        version: z.string(),
        tarball: z.string().optional(),
        sha256: z.string().optional(),
      }),
    ).default([]),

    pypi: z.array(
      z.object({
        name: z.string(),
        version: z.string(),
        wheel: z.string().optional(),
        sha256: z.string().optional(),
      }),
    ).default([]),

    homebrew: z.array(
      z.object({
        formula: z.string(),
        tap: z.string().optional(),
        sha256: z.string().optional(),
      }),
    ).default([]),

    scoop: z.array(
      z.object({
        manifest: z.string(),
        bucket: z.string().optional(),
        sha256: z.string().optional(),
      }),
    ).default([]),
  }),
});
```

`runtime.env` and `runtime.config` record runtime expectations, not secret values. For example, a binary that expects `ACME_API_URL` for remote dispatch must declare that env var in the manifest.

`metadata` exists so pure package renderers do not need to read `package.json`, git config, schema source, or build directories.

## Internal build record

The release manifest is not the internal build database. Use a separate internal build record for:

- local filesystem paths
- unsigned binary paths
- signing input paths
- upload staging paths
- temporary package directories
- CI run URLs
- local build logs
- full conformance logs

Only stable release-facing facts belong in the manifest.

## Release pipeline

Required pipeline:

```txt
1. Read binary artifacts from @lili/build output.
2. Apply signing/notarization hooks where configured.
3. Verify signature/notarization where configured.
4. Compute sha256 and size over final binary bytes.
5. Write CliReleaseManifest.
6. Render staged packages from the manifest.
7. Pack final package-manager artifacts.
8. Verify final packed artifacts against the manifest.
9. Publish.
10. Support yank/rollback from one manifest reference.
```

Do not verify staging directories as the final proof. Verify packed artifacts.

## Renderer selection

Release configuration must support zero to all renderers:

```txt
renderers: []
renderers: ["npm"]
renderers: ["pypi", "homebrew"]
renderers: "all"
```

An empty renderer list still writes the manifest and verifies final binary bytes. Selected renderers fail fast when their required metadata or credentials are missing. Unselected renderers must not block release.

## macOS ordering

For macOS release artifacts:

```txt
build
sign with JIT entitlements
notarize, if configured
verify signature
sha256
manifest
package renderers
final artifact verification
```

The manifest hash must be computed after signing because signing mutates binary bytes.

### Codesign entitlements

Bun-compiled binaries use JavaScriptCore JIT. Signing without JIT entitlements produces a binary that crashes on launch under Gatekeeper. The release pipeline must invoke `codesign` with an `entitlements.plist` containing at least:

- `com.apple.security.cs.allow-jit`
- `com.apple.security.cs.allow-unsigned-executable-memory`
- `com.apple.security.cs.disable-executable-page-protection`
- `com.apple.security.cs.allow-dyld-environment-variables`
- `com.apple.security.cs.disable-library-validation`

Signing invocation:

```sh
codesign --deep --force -vvvv \
  --sign "<identity>" \
  --entitlements entitlements.plist \
  --options runtime \
  ./acme
```

Required verification step after signing:

```sh
codesign -vvv --verify ./acme
```

A `release/macos-jit-entitlements` guard rail must reject any darwin binary whose signature is missing the JIT entitlements above. A binary that signs cleanly but lacks JIT entitlements is a worse failure mode than an unsigned binary because the failure surfaces only at end-user launch.

### Windows metadata

Windows binaries support compile-time metadata (`--windows-icon`, `--windows-hide-console`, plus title/publisher/version/description/copyright). Set these at compile time, not in the renderer. The release manifest's `metadata` section is the canonical source for publisher and version; the build pipeline must mirror those values into the Windows resource fields when producing `bun-windows-*` artifacts.

## npm renderer

npm renderer uses the esbuild-style package shape:

```txt
umbrella package
  optionalDependencies:
    @scope/cli-darwin-arm64: exact same version
    @scope/cli-linux-x64: exact same version
    ...

platform package
  os/cpu/libc filters
  exactly one binary
  no install scripts
```

The runtime shim must:

- resolve the current platform package through package-manager module resolution
- execute the packaged binary
- never download at install time
- emit one actionable error for missing optional dependencies, unsupported platform, pnpm optional omission, Yarn PnP spawn edge cases, or `--omit=optional`

Guard rails:

| Rule | Required check |
|---|---|
| `npm/version-skew` | Umbrella optional dependencies pin exact platform package versions from the same manifest. |
| `npm/no-scripts` | No install, postinstall, preinstall, prepare, or lifecycle scripts. |
| `npm/one-binary` | Each platform package contains exactly one executable. |
| `npm/hash` | Pack final `.tgz`, unpack it, hash the packaged binary, compare to manifest. |
| `npm/actionable-missing-optional` | Shim reports one clear actionable error. |

See `docs/npm-binary-packaging.md` for package JSON shapes, shim behavior, Linux libc handling, and final `.tgz` checks.

## PyPI renderer

When selected, renderer shape is:

```txt
wheel per platform
binary placed in .data/scripts/
entry point or script wrapper invokes that binary
RECORD hashes verified after wheel build
```

Linux wheel tags must match binary libc family:

- glibc targets map to `manylinux` decisions
- musl targets map to `musllinux` decisions

Guard rails:

| Rule | Required check |
|---|---|
| `pypi/platform-tag` | Bun target libc must match wheel tag family. |
| `pypi/record-hashes` | Wheel RECORD hashes match final wheel contents. |
| `pypi/one-binary` | Wheel contains the expected script binary and no unrelated compiled artifacts. |
| `pypi/pipx-entry` | pipx installation exposes the intended command name. |

## Homebrew renderer

When selected, renderer shape is:

```txt
formula with on_macos / on_linux branches
arch selection using Homebrew CPU helpers
url + sha256 from manifest
install copies one binary into bin
test do runs a real command
```

Guard rails:

| Rule | Required check |
|---|---|
| `homebrew/sha` | Formula sha256 equals manifest binary sha256. |
| `homebrew/platform-branch` | Every platform branch maps to exactly one manifest binary. |
| `homebrew/test` | Formula includes a non-trivial test, preferably more than `--version` or `--help`. |

## Scoop renderer

When selected, renderer shape is:

```txt
JSON manifest
architecture map
url + hash from manifest
bin command declaration
```

WinGet is a later asynchronous track because it typically involves a repository PR flow and must not block release.

## Yank command

One command should operate from the manifest:

```sh
li-releases yank ./release-manifest.json --reason "bad binary"
```

Expected behavior:

| Ecosystem | Behavior |
|---|---|
| npm | Deprecate affected packages. |
| PyPI | Yank affected files. |
| Homebrew | Revert or supersede tap commit. |
| Scoop | Revert or supersede bucket manifest. |
| WinGet | Open removal/update PR if configured. |

Yank/rollback must use one manifest reference so affected package-manager artifacts stay traceable to the same release.

## Final artifact verification

Required checks:

| Rule | Required check |
|---|---|
| `release/manifest-schema` | Manifest validates against `CliReleaseManifest`. |
| `release/schema-provenance` | Manifest contains schema name, version, commit, and canonical IR digest. |
| `release/runtime-contract` | Manifest records env/config expectations for remote transport and other runtime config. |
| `release/conformance-provenance` | Manifest records required conformance report metadata when release policy requires server conformance. |
| `release/binary-hash` | Final signed/notarized binary bytes match manifest sha256. |
| `release/binary-size` | Final binary size matches manifest size. |
| `release/npm-final-tgz` | Packed npm tarball contains expected files and binary hash. |
| `release/pypi-final-wheel` | Wheel RECORD hashes and packaged binary hash are correct. |
| `release/homebrew-final-formula` | Formula URL and sha256 match manifest. |
| `release/scoop-final-json` | Scoop manifest URL and hash match manifest. |
| `release/no-package-scripts` | No artifact contains install-time script execution unless explicitly approved. |
| `release/version-skew` | Every wrapper package version equals manifest release version. |

## Trust root note

The manifest improves auditability and renderer correctness. It is not magic security by itself.

Ecosystem trust still comes from:

- npm, PyPI, Homebrew tap repos, Scoop buckets, and other registries
- codesigning and notarization where applicable
- source control provenance
- CI provenance
- artifact hashing and verification
- user trust in the release publisher

## Acceptance criteria

Distribution MVP is accepted only when:

- manifest includes release version, schema provenance, runtime env/config expectations, and per-binary target/platform/arch/libc/url/sha256/size
- manifest includes renderer metadata needed by pure package renderers
- manifest can record conformance report metadata when publishing policy requires it
- renderers are pure manifest-to-staged-package functions
- renderer selection supports zero, one, many, or all implemented renderers
- npm renderer uses umbrella plus platform optional dependencies with exact version pins when selected
- npm final `.tgz` artifacts are verified, not just staging directories, when selected
- no selected renderer emits install-time script execution unless explicitly approved
- PyPI/Homebrew/Scoop renderers use the same manifest contract when selected
- no `release-extra` package exists
- yank command is planned from one manifest reference
- trust-root limitations are documented
