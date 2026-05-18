# Release renderer requirements

All first-party release renderers live in `@lili/releases`.

There is no `@lili/release-extra` package. npm is one renderer, not the privileged package boundary. Users choose zero to all renderers through release configuration.

## Renderer selection

Release configuration must support:

```txt
renderers: []
renderers: ["npm"]
renderers: ["pypi", "homebrew"]
renderers: "all"
```

`renderers: []` means manifest and final-binary verification only. It is valid for users who want to upload binaries manually or test release guard rails before publishing package-manager wrappers.

`renderers: "all"` means every implemented renderer whose required metadata and credentials are configured. Missing required metadata for a selected renderer is a release error before staging artifacts. Missing metadata for an unselected renderer is ignored.

## Package boundary

`@lili/releases` owns:

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

Renderer dependencies must stay out of `@lili/core` and `@lili/build`. If an ecosystem needs heavyweight tooling, load or invoke it only when that renderer is selected; do not create another first-party release package to hide the dependency problem.

## Renderer purity

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
});
```

Renderers must not read `package.json`, schema source, git config, generated source, or build output directories to recover metadata. The manifest is the renderer contract.

## npm renderer

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

Detailed npm package JSON and shim behavior lives in `docs/npm-binary-packaging.md`.

## PyPI renderer

Renderer shape:

```txt
wheel per platform
binary placed in .data/scripts/
entry point or script wrapper invokes that binary
RECORD hashes verified after wheel build
```

Linux tag decisions:

- glibc targets map to `manylinux` decisions
- musl targets map to `musllinux` decisions

Guard rails:

```txt
pypi/platform-tag
pypi/record-hashes
pypi/one-binary
pypi/pipx-entry
pypi/no-download
pypi/final-wheel-hash
```

## Homebrew renderer

Renderer shape:

```txt
formula with macOS/Linux and architecture branches
url + sha256 from manifest
install copies one binary into bin
test do runs a real command
```

Guard rails:

```txt
homebrew/sha
homebrew/platform-branch
homebrew/install-one-binary
homebrew/test
homebrew/no-stage-leak
homebrew/final-formula-matches-manifest
```

## Scoop renderer

Renderer shape:

```txt
JSON manifest
architecture map
url + hash from manifest
bin command declaration
```

Guard rails:

```txt
scoop/hash
scoop/architecture-map
scoop/bin
scoop/no-install-scripts
scoop/final-json-matches-manifest
```

## WinGet

WinGet is planned but must not block the initial `@lili/releases` package.

It usually requires repository PR workflow and should be treated as an asynchronous release follow-up unless explicitly prioritized.
