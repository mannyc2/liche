# npm binary packaging requirements

`@lili/releases` owns npm binary distribution as one selectable renderer.

The package shape follows the esbuild-style model:

```txt
umbrella package
  bin shim
  optionalDependencies on platform packages

platform package
  os/cpu/libc filters
  exactly one binary
  no install scripts
```

## Umbrella package

Representative `package.json`:

```json
{
  "name": "@acme/cli",
  "version": "1.2.3",
  "description": "Acme CLI",
  "license": "MIT",
  "homepage": "https://example.com",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/acme/cli.git"
  },
  "type": "module",
  "bin": {
    "acme": "./bin/acme.js"
  },
  "files": [
    "bin/acme.js",
    "README.md",
    "package.json"
  ],
  "optionalDependencies": {
    "@acme/cli-darwin-arm64": "1.2.3",
    "@acme/cli-darwin-x64": "1.2.3",
    "@acme/cli-linux-arm64": "1.2.3",
    "@acme/cli-linux-x64": "1.2.3",
    "@acme/cli-linux-arm64-musl": "1.2.3",
    "@acme/cli-linux-x64-musl": "1.2.3",
    "@acme/cli-windows-x64": "1.2.3",
    "@acme/cli-windows-arm64": "1.2.3"
  }
}
```

No `scripts`.

## Platform package

Representative Linux x64 glibc package:

```json
{
  "name": "@acme/cli-linux-x64",
  "version": "1.2.3",
  "description": "Acme CLI binary for Linux x64 glibc",
  "license": "MIT",
  "os": ["linux"],
  "cpu": ["x64"],
  "libc": "glibc",
  "files": [
    "bin/acme",
    "package.json",
    "README.md"
  ]
}
```

Representative Windows x64 package:

```json
{
  "name": "@acme/cli-windows-x64",
  "version": "1.2.3",
  "description": "Acme CLI binary for Windows x64",
  "license": "MIT",
  "os": ["win32"],
  "cpu": ["x64"],
  "files": [
    "bin/acme.exe",
    "package.json",
    "README.md"
  ]
}
```

No platform package exposes its own `bin` unless a later package-manager behavior proves it is needed. The umbrella exposes the command.

## Shim behavior

The shim must:

- resolve candidate platform packages with Node module resolution
- execute the packaged binary with inherited stdio
- never download on install or first run
- produce one actionable error when no binary can be used
- keep working when optional dependencies were omitted by package-manager settings

Linux libc handling must not blindly stop on the first resolved Linux candidate. If both glibc and musl packages are installed, or a package manager ignores libc filters, the shim must choose correctly or continue after an incompatible binary spawn failure.

Use Node-native libc detection when practical. Avoid adding a runtime dependency only for libc detection unless local testing proves Node-native detection is insufficient.

## Missing binary errors

Report one actionable error for:

- unsupported platform or architecture
- optional dependencies omitted
- platform package not installed due to package-manager config
- Yarn PnP virtual filesystem cannot spawn binary
- resolved binary missing
- resolved binary not executable
- platform package version mismatch

## Final `.tgz` verification

Verification runs on packed artifacts, not staging directories.

Required checks:

| Rule | Required check |
|---|---|
| `npm/pack-created` | Final `.tgz` exists. |
| `npm/no-scripts` | No package has preinstall/install/postinstall/prepare scripts. |
| `npm/version-skew` | Umbrella optionalDependencies exactly equal release version. |
| `npm/platform-fields` | Platform package `os`/`cpu`/`libc` fields match manifest target. |
| `npm/one-binary` | Each platform `.tgz` contains exactly one binary. |
| `npm/hash` | Unpacked `.tgz` binary sha256 equals manifest binary sha256. |
| `npm/shim-actionable-error` | Shim produces controlled error when no platform package is resolvable. |
| `npm/no-download` | Shim and package scripts never download at install or first run. |

## Tests

Required tests:

- render umbrella package with exact optional dependency pins
- render platform packages with correct filters
- reject any lifecycle scripts
- pack and verify final `.tgz`
- simulate missing optional dependency
- simulate unsupported platform
- simulate version skew
- verify shim preserves child exit status
- verify shim handles spawn failure with actionable error
