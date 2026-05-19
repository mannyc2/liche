# Distribution requirements

`@lili/releases` owns the distribution contract. It consumes final binary artifacts and produces a release manifest plus selected package-manager artifacts rendered from that manifest.

Package-manager wrappers are delivery mechanisms. The compiled binary is the product.

## Manifest invariant

The release manifest is the only contract between binary production and package-manager wrappers.

Renderers must be pure functions:

```txt
release manifest -> staged package artifact
```

Renderers must not read product schema files, generated source, package workspaces, or build output directories except through manifest references.

Renderers and publishers are separate concerns:

| Term | Meaning | Needs credentials? |
|---|---|---:|
| Renderer | Pure manifest-to-artifact stage that writes package-manager artifacts. | no |
| Publisher | Registry or repository mutation that uploads or updates already-verified artifacts. | yes |

Renderer preflight checks manifest metadata and selected-renderer configuration only. Publisher preflight checks credentials, repository bindings, registry state, and mutation ordering.

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
    executable: z
      .object({
        title: z.string().optional(),
        publisher: z.string().optional(),
        copyright: z.string().optional(),
        windows: z
          .object({
            hideConsole: z.boolean().default(false),
            iconSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
          })
          .optional(),
      })
      .optional(),
  }),

  product: z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    commit: z.string(),
    catalogDigest: z.string(),
    surfaceManifest: z
      .object({
        path: z.string(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .optional(),
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

  auth: z
    .object({
      providers: z.array(
        z.object({
          id: z.string(),
          kind: z.enum(["none", "bearer", "apiKey", "oauthDevice"]),
          credentialTransport: z.enum(["none", "bearer", "apiKey"]).optional(),
          modes: z.array(z.enum(["env", "session", "oauth-device"])).default([]),
          envVars: z.array(
            z.object({
              name: z.string(),
              purpose: z.string(),
            }),
          ).default([]),
          commands: z
            .object({
              login: z.string().optional(),
              logout: z.string().optional(),
              whoami: z.string().optional(),
              switch: z.string().optional(),
            })
            .optional(),
          contexts: z.array(
            z.object({
              id: z.string(),
              envVar: z.string().optional(),
              flag: z.string().optional(),
            }),
          ).default([]),
          sessionStorage: z
            .object({
              used: z.boolean(),
              profiles: z.boolean(),
              storesAccessTokens: z.boolean(),
              storesRefreshTokens: z.boolean(),
              keychainRequired: z.boolean(),
            })
            .optional(),
          requiredRuntimeCapabilities: z.array(z.string()).default([]),
        }),
      ).default([]),
    })
    .optional(),

  conformance: z.object({
    required: z.boolean().default(false),
    report: z.string().optional(),
    reportVersion: z.number().int().positive().optional(),
    reportSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    checkedAt: z.string().optional(),
    targetEnv: z.string().optional(),
    targetBaseUrl: z.string().url().optional(),
    catalogDigest: z.string().optional(),
    destructiveIncluded: z.boolean().default(false),
    summary: z
      .object({
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .optional(),
  }).optional(),

  binaries: z.array(
    z.object({
      id: z.string(),
      target: z.string(), // exact Bun --target value passed to bun build --compile

      platform: z.enum(["darwin", "linux", "windows"]),
      arch: z.enum(["arm64", "x64"]),
      libc: z.enum(["glibc", "musl"]).optional(),
      cpuVariant: z.enum(["baseline", "modern"]).optional(),
      filename: z.string(),

      url: z.string().url(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      size: z.number().int().positive(),
      compileFlagsDigest: z.string().optional(),

      signed: z.boolean().default(false),
      notarized: z.boolean().default(false),
    }),
  ),

  packages: z.array(
    z.object({
      id: z.string(),
      renderer: z.enum(["npm", "pypi", "homebrew", "scoop"]),
      ecosystem: z.enum(["npm", "pypi", "homebrew", "scoop"]),
      kind: z.string(),
      name: z.string(),
      version: z.string(),
      targetBinaryId: z.string().optional(),
      artifact: z
        .object({
          fileName: z.string(),
          url: z.string().url().optional(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          size: z.number().int().positive(),
        })
        .optional(),
      publish: z
        .object({
          registry: z.string().optional(),
          repository: z.string().optional(),
          channel: z.string().optional(),
        })
        .optional(),
    }),
  ).default([]),
});
```

`runtime.env` and `runtime.config` record runtime expectations, not secret values. For example, a binary that expects `ACME_API_URL` for remote dispatch must declare that env var in the manifest.

`auth` records non-secret auth/session expectations. It may include provider IDs, auth modes, token env var names, generated auth command names, context env/flag names, session-storage posture, and required runtime capabilities. It must not include selected profile, selected org/project values, tokens, refresh tokens, API keys, account email, keychain references, or session file paths.

`metadata` exists so pure package renderers do not need to read `package.json`, git config, product schema source, or build directories.

`product.catalogDigest` is the normalized catalog digest. Do not record a digest of raw product schema source text as the release provenance anchor.

`binaries[].target` stores the exact Bun `--target` string used at compile time, including `baseline`, `modern`, and `musl` when present. `platform`, `arch`, `libc`, and `cpuVariant` are normalized fields used by renderers and must agree with the target string.

`packages[]` records stable release-facing package identities and intended artifacts. The `artifact` field is present only when the artifact has a stable release-facing filename/hash/URL; local staging paths, local packed-artifact paths, temporary upload paths, and registry credentials belong in the internal build record or publisher input. Publishing automation consumes the release manifest plus verified artifact records that map package IDs to local files.

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
- local packed package artifact paths
- publisher credential source names

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
9. Publish from the manifest plus verified artifact records, when requested.
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

An empty renderer list still writes the manifest and verifies final binary bytes. Selected renderers fail fast when their required manifest metadata or renderer configuration is missing. Unselected renderers must not block release. Publisher credentials are checked only by publishing automation, after package artifacts have been rendered and verified.

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

Windows binaries support compile-time metadata (`--windows-icon`, `--windows-hide-console`, plus title/publisher/version/description/copyright). Set these at compile time, not in the renderer. The release manifest's `metadata.executable` section records the stable values mirrored into Windows resource fields. Local icon paths belong in the internal build record; the manifest may record the embedded icon hash through `metadata.executable.windows.iconSha256`.

Bun currently cannot use the Windows metadata flags while cross-compiling because those flags depend on Windows APIs. A release matrix that requires Windows resource metadata must either build Windows binaries on Windows or fail before manifest creation.

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
| `release/catalog-provenance` | Manifest contains product id, name, version, commit, and catalog digest. |
| `release/runtime-contract` | Manifest records env/config expectations for remote transport and other runtime config. |
| `release/auth-contract` | Manifest records non-secret auth providers, modes, env var names, generated auth commands, context selectors, and session-storage posture. |
| `release/conformance-provenance` | Manifest records required conformance report metadata when release policy requires server conformance. |
| `release/target-normalization` | Every binary target string agrees with platform, arch, libc, and cpu variant fields. |
| `release/binary-hash` | Final signed/notarized binary bytes match manifest sha256. |
| `release/binary-size` | Final binary size matches manifest size. |
| `release/npm-final-tgz` | Packed npm tarball contains expected files and binary hash. |
| `release/pypi-final-wheel` | Wheel RECORD hashes and packaged binary hash are correct. |
| `release/homebrew-final-formula` | Formula URL and sha256 match manifest. |
| `release/scoop-final-json` | Scoop manifest URL and hash match manifest. |
| `release/no-package-scripts` | No artifact contains install-time script execution unless explicitly approved. |
| `release/version-skew` | Every wrapper package version equals manifest release version. |
| `release/package-records` | Every packed package artifact has a package or verified-artifact record with renderer, ecosystem, kind, version, sha256, and size. |

## Trust root note

The manifest improves auditability and renderer correctness. It is not magic security by itself.

Ecosystem trust still comes from:

- npm, PyPI, Homebrew tap repos, Scoop buckets, and other registries
- codesigning and notarization where applicable
- source control provenance
- CI provenance
- artifact hashing and verification
- registry-provided provenance and attestations where available
- user trust in the release publisher

Modern registry provenance should be integrated when the selected publisher supports it:

- npm publishing should prefer Trusted Publishing/OIDC and preserve generated provenance attestations when available.
- PyPI publishing should prefer Trusted Publishers and attach or preserve supported digital attestations when available.
- GitHub Release uploads should support artifact attestation generation and verification when the release runs in GitHub Actions.
- SBOM generation is not required for the first release slice, but the manifest and artifact record model must leave room for SBOM artifact IDs and hashes.

These mechanisms raise the audit bar but do not replace binary hashing, package verification, signing/notarization, or publisher trust.

Upstream reference points for these requirements:

- Bun standalone executable targets, runtime config loading, Windows metadata, and macOS JIT signing: `https://bun.sh/docs/bundler/executables`
- npm package `os`/`cpu`/`libc` fields and trusted publishing: `https://docs.npmjs.com/cli/v11/configuring-npm/package-json` and `https://docs.npmjs.com/trusted-publishers/`
- Python wheel layout, tags, and `RECORD`: `https://packaging.python.org/en/latest/specifications/binary-distribution-format/`
- PyPI digital attestations and trusted publishers: `https://docs.pypi.org/attestations/`
- Homebrew formula shape: `https://docs.brew.sh/Formula-Cookbook`
- Scoop manifest shape: `https://github.com/ScoopInstaller/Scoop/wiki/App-Manifests`

## Acceptance criteria

Distribution MVP is accepted only when:

- manifest includes release version, product/catalog provenance, runtime env/config expectations, and per-binary target/platform/arch/libc/cpuVariant/url/sha256/size
- manifest includes renderer metadata needed by pure package renderers
- manifest includes non-secret auth/session expectations when auth providers are configured
- manifest can record conformance report version, hash, target, summary, catalog digest, and destructive-case status when publishing policy requires conformance
- manifest can record executable metadata needed for Windows resource fields without embedding local icon paths
- manifest includes stable package identity records and can be joined to verified artifact records by package ID
- renderers are pure manifest-to-staged-package functions
- renderer selection supports zero, one, many, or all implemented renderers
- renderer preflight and publisher credential preflight are separate
- npm renderer uses umbrella plus platform optional dependencies with exact version pins when selected
- npm final `.tgz` artifacts are verified, not just staging directories, when selected
- no selected renderer emits install-time script execution unless explicitly approved
- PyPI/Homebrew/Scoop renderers use the same manifest contract when selected
- no `release-extra` package exists
- yank command is planned from one manifest reference
- trust-root limitations are documented
