# Research request: developer experience for multi-platform CLI distribution

## Context

We are building a TypeScript library suite that helps developers author, compile, and release multi-platform CLI tools from a Bun-based codebase. The intended consumer is a developer who:

- writes their CLI in TypeScript
- wants to ship native binaries (no Node/Bun installed on the user's machine) for macOS (arm64, x64), Linux (arm64 + x64, glibc + musl), and Windows (x64)
- wants those binaries distributed across the standard ecosystem channels: **npm, PyPI, Homebrew, Scoop**
- already has CI/CD (typically GitHub Actions) and is comfortable with YAML
- expects publishing itself to be handled by ecosystem-maintained tooling (`pypa/gh-action-pypi-publish`, `npm publish`, etc.), not by our tool

The suite is split into two packages with a deliberate boundary:

| Package | Responsibility |
|---|---|
| Build | Compile a TypeScript entrypoint to native binaries for a target matrix. Emits a typed `BuildRecord` (per-binary path, sha256, size, target facts). |
| Releases | Take a `BuildRecord` + distribution config, render ecosystem-specific package artifacts (npm tarballs/dirs, PyPI wheels, Homebrew formula, Scoop manifest), and write them to disk. |

Both packages expose a programmatic API and a CLI (`li-build build`, `li-release package`). The downstream publish step uses standard ecosystem CI actions.

We have implemented this far enough to have a working end-to-end pipeline, but several design questions remain unresolved. This research request asks for evidence-grounded answers and concrete recommendations based on how widely-used multi-platform CLI projects actually ship today.

## Primary question

**For multi-platform CLIs distributed via npm with an umbrella package + per-platform-binary packages (the `esbuild` / `swc` / `biome` / `@napi-rs/cli` pattern):**

> Should the renderer produce pre-packed `.tgz` tarballs in a flat directory, or unpacked package directories (each containing its own `package.json` + binary file tree)?

Specifically:

1. What is the dominant convention across popular multi-platform Node CLIs today (with citations)? Survey at least: `esbuild`, `swc`, `biome`, `rolldown`, `@napi-rs/cli`, `oxlint`, `prettier`'s native build, `lefthook`, `turborepo`, `bun`'s own distribution.
2. Does `npm publish --provenance` work equivalently on a pre-packed tarball vs an unpacked directory? Are there any provenance attestation differences?
3. Does trusted publishing (`id-token: write`) behave identically across both forms?
4. What is the practical effect on the publish step's ordering invariant (platform packages before the umbrella so `optionalDependencies` resolve at install time)?
5. Are there any signing, integrity-check, or registry-side validation differences?
6. Which form is easier for downstream consumers to inspect / test before publishing?

## Secondary anxieties to resolve

### Group A: how do real multi-platform CLI projects actually ship?

For each of: `esbuild`, `swc`, `biome`, `bun`, `deno`, `uv` (Astral), `ripgrep`, `fd`, `bat`, `zoxide`, `cargo-binstall`, `oxlint`, `rolldown`, `turbo`:

1. How is their build matrix defined? In a script, a config file, a CI matrix, or generated from a higher-level config?
2. How do they coordinate version + identity across npm, PyPI (where applicable), Homebrew, Scoop, and direct GitHub Release downloads?
3. Do they ship a single config file that declares all distribution intent, or do they spread config across `package.json`, `pyproject.toml`, formula files, manifest files, and CI YAML?
4. Do they have a unified build CLI of their own, or do they wire together existing tools (`cargo`, `napi-rs`, `goreleaser`, etc.)?
5. What does their release workflow YAML actually look like, end-to-end? (Provide links to the canonical workflow files.)
6. How long is the typical release workflow file in lines of YAML? How much of that is glue vs essential?

### Group B: CLI surface design for build + release tools

7. For developer-facing build/release tools (`wrangler`, `vercel`, `cargo`, `goreleaser`, `napi`, `cargo dist`, `tauri`, `oclif`, `pkg`, `caxa`, `vite`, `esbuild` CLI, `tsup`): what is the standard hierarchy?
   - positional argument for the primary thing (entrypoint? binary? directory?)
   - flags for everything else
   - config file for repeated settings
8. Which of those tools require a config file, which support pure-flag invocation, and which support both? Provide examples of the simplest possible invocation for each.
9. How do they handle config file discovery (auto-discover vs explicit `--config`)? What auto-discovery search order do they use?
10. How do they handle config precedence when both flags and config file are present?
11. Do any of them use a typed TypeScript config file (the `vite.config.ts` / `wrangler.toml` / `tauri.conf.json` pattern)? Pros/cons observed in practice?
12. For monorepo support: do they use `--cwd`, `--package`, `--workspace`, or some other mental model?

### Group C: the build → release boundary

13. Is it more common in production tooling to expose **one command** that does build + package in one shot (like `goreleaser`, `cargo dist`), or **two commands** with a typed artifact passed between them (the pattern we're building)?
14. What are the documented arguments for and against each?
15. For tools that emit a "build record" / "manifest" artifact between phases (`cargo dist`'s plan, `goreleaser`'s release notes, `napi-rs`'s artifacts directory): what does the artifact look like? What fields are non-obvious?
16. Do users actually consume that intermediate artifact, or is it just a CI plumbing detail?

### Group D: binary hosting patterns

17. What fraction of popular multi-platform CLIs host their compiled binaries on:
    - GitHub Releases assets
    - npm packages themselves (binary embedded in tarball)
    - PyPI packages themselves (binary embedded in wheel)
    - Dedicated CDN (Cloudflare R2, S3, custom)
    - Self-hosted download server
18. For tools that use multiple hosting paths, how do they keep URLs + integrity hashes consistent across them?
19. What URL templating patterns do Homebrew tap and Scoop bucket update tools expect for the binary's `url` field?
20. How do tools handle the chicken-and-egg problem where Homebrew formula / Scoop manifest must embed a binary URL that has to exist on the registry side before the formula/manifest is published?

### Group E: Homebrew + Scoop publishing

21. What is the recommended way to publish a Homebrew formula to a tap repo: commit a pre-rendered `.rb` file, or use a bump-formula action that re-renders the formula from a GitHub release URL? Survey: `dawidd6/action-homebrew-bump-formula`, `mislav/bump-homebrew-formula-action`, `Homebrew/actions/setup-homebrew`, manual `git commit`.
22. Same question for Scoop bucket updates.
23. If both styles exist, which is more common in 2025? Are there any registry-side advantages to one over the other?
24. Do these actions support custom formulae (multi-arch binaries with branched `on_macos do ... on_linux do ... end` blocks) or do they only handle simpler single-binary cases?
25. What is the state of the art for Homebrew core formula submission for genuinely cross-platform tools? Is `brew bump-cask-pr` / `brew bump-formula-pr` automation common?

### Group F: trusted publishing + OIDC

26. For npm trusted publishing: the npm CLI auto-detects GitHub Actions OIDC env vars and exchanges them itself. Is there any meaningful value in a CLI wrapper that mints the token via the documented `/-/npm/v1/oidc/token/exchange/package/{name}` API and uses it directly, vs just shelling out to `npm publish`?
27. For PyPI trusted publishing: `pypa/gh-action-pypi-publish` does the audience discovery + mint-token + upload. Should a third-party tool reimplement that, or always delegate?
28. How do `goreleaser`, `cargo dist`, and `napi-rs` handle credentials? Do they support both static tokens and OIDC trusted publishing? Do they implement the exchange themselves or delegate?
29. What credential adapter conventions exist? (Env var names per ecosystem, secret manager integrations, `.netrc` discovery, etc.)
30. What does "best practice" look like for keeping credentials out of release plans / dry-run output?

### Group G: programmatic API + CLI parity

31. For tools that explicitly support both forms (Bun's `Bun.build()` + `bun build`, esbuild's `build()` + `esbuild` CLI, Vite's `build()` + `vite build`): how do they design the API such that the CLI is a thin shell rather than a parallel reimplementation?
32. What patterns do they use for shared option parsing? Schema-first (Zod, Valibot)? Hand-rolled? Borrowing from `oclif` / `commander` / `yargs`?
33. How do they document the API/CLI parity? Is there one canonical source of truth (e.g., the API reference is generated from the CLI flag schema)?
34. Do any of these tools find their CLI surface becomes a forcing function for keeping the API simple? Or do they routinely have CLI-only or API-only options?

### Group H: target presets + matrix expressivity

35. What target matrices do popular multi-platform CLIs actually ship in 2025? Specifically: is `linux-arm64-musl` worth including by default? What about baseline CPU variants (no AVX2)?
36. How do tools express target presets? `cargo dist`'s `targets` array, `goreleaser`'s build matrix YAML, `napi-rs`'s native matrix?
37. For tools that maintain a curated target table (similar to what we're building): how do they handle new platforms (e.g., Windows-on-ARM, FreeBSD, riscv64-linux)?
38. Is there a meaningful audience that wants to ship to less-common targets (FreeBSD, OpenBSD, illumos, ARM7l musl)? Are any popular CLIs doing this?

### Group I: the "100-line release script" problem

39. For multi-platform CLI projects that have a substantial release workflow, what fraction of that workflow is:
    - actually essential coordination
    - duplicated knowledge between matrix YAML and a release script
    - boilerplate (download artifacts, set up auth, etc.)
    - one-off project-specific logic
40. Are there projects whose release workflow is genuinely short (< 50 lines of YAML) because they offloaded everything to a single tool? Which tools achieve that? What is the smallest realistic workflow for a fully cross-platform CLI shipping to all four ecosystems (npm + PyPI + Homebrew + Scoop)?
41. Where do projects keep distribution config that doesn't fit naturally into `package.json`? Examples: Homebrew tap repo + formula name, Scoop bucket repo + manifest name, custom CDN URL templates, signing identities.
42. How successful are typed-config-file approaches (`vite.config.ts`, `wrangler.toml`, `tauri.conf.json`) at reducing CI YAML in practice?

### Group J: documentation conventions

43. For a developer adopting a new build/release tool: what does the canonical "getting started" page look like? Survey at least three tools and document the shape: ordered list of steps, side-by-side CLI + API examples, an "in CI" section, etc.
44. Where do users get stuck most often? (StackOverflow questions, GitHub issues, Discord/Discourse threads — find the patterns.)
45. What documentation gaps are common across competitors that we should preemptively close?

## Constraints on the answer

- **Evidence-grounded**: every claim about "what tools do" should link to a real repo, workflow file, doc, or release. Speculation should be labeled as such.
- **Durable citations only**: do not commit transient agent citation IDs such as `turn22view0`; convert any useful finding to a stable URL before it becomes repo documentation.
- **2024-2025 currency**: trusted publishing on npm and the related OIDC story changed significantly in 2024. Older sources may be misleading.
- **Specific to compiled binary CLIs**: research can mention pure-JS CLIs for contrast but the primary audience ships native binaries.
- **Pragmatic over comprehensive**: we want recommendations we can act on, not an academic taxonomy.

## Deliverable shape

The ideal output is a single document containing:

1. **Direct answer to the primary question** (npm tarballs vs unpacked directories) with citations and a recommendation.
2. **A best-practices summary** — three to seven concrete recommendations for a build/release tool's developer experience, each justified by ecosystem evidence.
3. **A competitive landscape table**: rows are popular multi-platform CLIs, columns are the dimensions in Group A (matrix definition, config location, CLI vs config-file, ecosystems supported, binary hosting, workflow length).
4. **Open questions** the research could not resolve — explicitly flagged so we know where to do our own validation.

Length budget: 3000-6000 words. Tables and code blocks counted toward the budget. If the research can answer in fewer words while being concrete, do.
