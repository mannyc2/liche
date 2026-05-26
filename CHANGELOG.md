# Changelog

All notable changes to the liche package suite are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the suite follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) with synchronized versions across:

- `@liche/core`
- `@liche/extensions`
- `@liche/product`
- `@liche/build`
- `@liche/releases`

While the suite is pre-`1.0.0`, minor bumps (`0.x.0`) are the breaking-change lane and patch bumps (`0.x.y`) preserve public imports and command behavior. See [release-and-distribution.md](./docs/release-and-distribution.md#versioning-policy) for the full policy.

## Unreleased

## 0.6.0 — 2026-05-26

### Added

- **`@liche/core`: `defineGlobal({ default })`.** Globals can declare a pre-resolved fallback that populates `ctx.global.<key>` when the flag is absent and renders as `(default: …)` in help. `parse` does not run on the default.

  ```ts
  defineGlobal({ key: 'db', type: 'string', default: 'twitte.sqlite', valueLabel: 'path' })
  ```

- **`@liche/core`: per-command output renderers via `defineCommand({ formats })`.** Attach a format-specific render function on a single command without registering a CLI-wide renderer. Runs at the `result` stage when the chosen output format matches; structured formats (`--json`) still route to the registered renderer.

  ```ts
  defineCommand({
    path: ['report'],
    formats: { md: (data) => formatTable(data) },
    run: () => collectRows(),
  })
  ```

- **`@liche/core`: value tokens in the per-command options table.** Non-boolean options render as `--name <name>` in help (matching the usage line). Override the placeholder via zod meta: `z.string().meta({ valueLabel: 'path' })`.

- **`@liche/core`: bare-string shorthand for single-segment command aliases.** `defineCommand({ aliases: ['find', ['s']] })` is accepted alongside the existing nested-array form.

### Changed

- **`@liche/core`: standard globals are now explicit controls.** Plain `defineCli()` no longer reserves `--help`, `--version`, `--json`, `--format`, `--schema`, `--llms`, or output-slicing flags. Install `help()`, `version()`, `outputControls()`, and `reflectionControls()` for those Core-owned flags.
- **`@liche/agents`: `--llms` moved out of Core.** Install `llms()` directly or `agents()` for the bundled agent surface. Product-generated CLIs now install their selected controls visibly in generated source and reject `--format` through normal unknown-option parsing instead of `disabledGlobals`.

## 0.4.0 — 2026-05-24

### Changed

- **`@liche/extensions`: removed the broad `support` subpath.** Local telemetry primitives moved to `@liche/telemetry`. Imports must move to the focused package:

  ```diff
  - import { createLocalTelemetrySink } from "@liche/extensions/support";
  + import { createLocalTelemetrySink } from "@liche/telemetry";
  ```

- **`@liche/product`: generated `doctor` is now Product-owned generated code** rather than a public helper exported from `@liche/extensions`. Diagnostics now scale with your catalog (config fields, remote base URLs, auth providers, session/context, agent-readiness) without a separate install. Regenerate Product surfaces to pick up the new `doctor` command:

  ```sh
  liche-product generate ./product.ts --out ./generated
  ```

## 0.3.1 — 2026-05-24

Release-candidate hardening. No public API changes.

### Added

- `bun run release:check` — local release-candidate gate. Runs typechecks, package tests, example smokes, metrics, offline metadata checks, and whitespace diff checks. No network access required.
- `bun run --silent metrics` — records per-package source/test LOC, public exports, runtime dependencies, and package-boundary exceptions for release-candidate review.
- `bun run --silent release:metadata` — offline check that every publishable package has `LICENSE`, narrow `files` lists, and no placeholder package metadata.
- `bun run release:names` — live npm registry status probe (kept separate from `release:check` so network/ownership facts don't make local RC checks flaky).
- `SECURITY.md`, `SUPPORT.md`, per-package `LICENSE` files.

## 0.3.0 and earlier

`@liche/core` `0.2.0` and `0.3.0`, and `0.3.0` of the rest of the suite, were published during the pre-public rewrite. They are listed here for completeness but predate this changelog and are not recommended for new projects — start from `0.4.0` or later.
