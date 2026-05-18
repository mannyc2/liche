# Docs log

## 2026-05-18

- Created initial rewrite docs structure.
- Added requirement links for invariant, build system, distribution, and rewrite coverage.
- Added target package layout requirements for the future Bun monorepo cutover.
- Recorded package boundary decision: required packages are `@incur/core`, `@incur/build`, and `@incur/release`; `@incur/release-extra` is conditional. Superseded below by the unified `@incur/releases` decision.
- Added application integration guidance for Vite/TanStack-style apps: define operations, implement API routes, generate CLI/surfaces, run conformance.
- Recorded execution-direction correction: `.serve()` is argv command execution, `.fetch()` is inbound HTTP handling, fetch-backed commands are in-process Request/Response bridges, and outbound remote HTTP operation transport is a separate core primitive.
- Recorded remote dispatch decision: `remote.{method,path}` in the schema means generated commands call core-owned outbound HTTP operation transport.
- Recorded OpenAPI decision: generated OpenAPI is output from canonical schema IR, not input to the MVP.
- Recorded server conformance decision: `@incur/build` owns `conform`; `generate --check` remains artifact freshness; release can consume conformance reports.
- Recorded release provenance decision: manifest must include runtime env/config expectations such as remote base URL and auth env names.
- Added focused requirement docs for HTTP transport, schema IR/OpenAPI, server conformance, npm binary packaging, and conditional release-extra renderers. Superseded below by `docs/releases.md`.
- Recorded release-extra gate decision: keep `@incur/release-extra` conditional until non-npm distribution is accepted as first-release scope. Superseded below by the single-package release renderer plan.
- Recorded transport refinement: pure request serializer first; `callHttpOperation` returns parsed output and throws structured core errors.
- Condensed docs tree: removed `concepts/`, `api/`, and `release/` pointer-file subdirectories (their content was paraphrases of root requirement files). Removed `index.md`; folded reading order into `docs/AGENTS.md`. Renamed `coverage-matrix.md` → `coverage-current.md` and `rewrite-coverage-matrix.md` → `coverage-rewrite.md` for clarity. Removed empty `sources/` placeholder directory and its associated rules (DOCS-002).
- Replaced the conditional `release-extra` package plan with a single `@incur/releases` package. Release renderers are now zero-to-all configuration choices inside that package; npm is not a special package boundary.
- Added `docs/next-plan.md` to define the monorepo cutover, build slices, remote/conformance slice, and renderer-neutral releases spine.
- Added generated-surface graph requirements so schema-driven systems can keep CLI, OpenAPI, MCP command tools, Agent Skills, docs, config schema, and later OpenAPI/product-specific adapters synchronized through explicit provenance and drift checks. Product-specific surfaces such as `wrangler.jsonc`, Workers Binding RPC metadata, dashboard metadata, SDKs, Terraform, Code Mode MCP, and generated server/API code remain adapter-gated rather than MVP behavior.
- Recorded agent consistency audit gaps: current core accepts arbitrary verbs/flags, advertises `--format`, has helper commands that ignore `--json`, lacks generated local/remote output signaling, and emits runtime-reflection OpenAPI that does not consume canonical remote bindings. Added Phase 2A and rewrite coverage rows to close these gaps.
- Clarified that canonical IR is a command/operation contract, not a product or domain model. Added `effects.kind` as the safety/lint axis, made the command manifest / `schema --json` generated surface explicit, and required fixtures that keep workflow commands first-class alongside optional CRUD/resource sugar.
- Renamed project from the upstream-derived `incur` placeholder to `lili`. Forward-facing package names are now `@lili/core`, `@lili/build`, `@lili/releases`; primary binary is `li`; build CLI binary is `li-build` (placeholder, decision deferred to Phase 3); error class `IncurError` → `LiliError`; observable strings `Incur.*Error`, `incur.cli.state`, `incur.v1`, `*.incur.*` paths, `~/.config/incur/`, `incur.local`, schema/generated file naming all renamed accordingly. Historical log entries above retain their original `@incur/*` names. Ancestry references in `AGENTS.md`, `test/parity.test.ts`, and `docs/package-layout.md` retensed and preserved. Old single-commit git history (`91b3db2 Initial imported artifact`) discarded; new history starts from this rename.
