# Roadmap

This is the current direction for the liche package suite. Detailed historical implementation plans are preserved in [CHANGELOG.md](./CHANGELOG.md).

## Where we are

The synchronized first-party package suite (`@liche/core`, `@liche/extensions`, `@liche/product`, `@liche/build`, `@liche/releases`) is at `0.4.x`.

The local toolchain is functionally complete:

```txt
define capabilities -> generate surfaces -> compile binary -> package/publish artifacts
```

- `@liche/core` runtime is locked to the `defineCli` / `defineCommand` declarative API with the `CliExtension` protocol for optional surfaces.
- `@liche/product` generates CLI, OpenAPI, command manifest, MCP, agent reference, docs, config JSON Schema, and discovery artifacts from a single `defineProduct({ ... })` catalog, with drift detection through `generate --check`.
- `@liche/extensions` owns optional config, completions, agent helper installers, auth/session workflows, and telemetry sink adapters.
- `@liche/build` compiles standalone Bun binaries with recorded provenance.
- `@liche/releases` renders npm, PyPI, Homebrew, and Scoop artifacts from one release manifest and verifies final byte hashes; `liche-release publish` produces dry-run plans and runs npm/PyPI/Homebrew/Scoop executors with byte rechecks.

Versioning policy is pre-`1.0.0` and synchronized across the suite. `1.0.0` is reserved for an API freeze after real downstream use, not as a symbolic milestone.

## V1 release-candidate gates (remaining)

Before the first broadly publicized release:

- Run `bun run release:check` cleanly on the candidate.
- Run `bun run --silent release:names` near publication time to verify npm package-name availability and ownership rights.
- Fill publisher-confirmed package metadata: repository, homepage, funding/support, provenance, semver, security disclosure.
- Run npm/PyPI trusted-publishing / OIDC preflight in the actual publishing environment.
- Verify GitHub release artifact layout and checksums against the final release manifest.
- Spot-check that no secrets appear in manifests, docs, examples, logs, generated surfaces, telemetry output, or release receipts.
- Lock the API stability policy for experimental subpath exports.
- Publish the support matrix: Bun versions, OS targets, binary targets, explicit "Node unsupported for v1" statement.
- Decide the public docs hosting lane: README-only, static site, or generated reference + examples.

Hosted telemetry, release dashboard, hosted catalog, org/team admin, audit logs, billing, policy sync, and uptime commitments are explicitly **not** v1 gates.

## V2: hosted platform

V2 is a hosted operating layer over the v1 toolchain. It must consume v1 contracts and artifacts; it must not become required for generating, compiling, packaging, publishing, or running a CLI.

```txt
release records -> hosted visibility -> policy -> audit -> team workflows
```

### V2A: read-only release visibility

Ingest v1 release manifests and publisher receipts; show release history, artifact integrity, package-manager status, channels, yanks. No hosted publishing or telemetry yet.

### V2B: hosted telemetry

Ingest v1 telemetry events into a hosted store with strict redaction and retention. Schema-validated, opt-in. Dashboards distinguish `cli` / `ci` / `agent` / `mcp` invocations. Customer export available before broad rollout.

### V2C: catalog and policy

Index catalogs (private + public) and enforce organization policy for releases and generated surfaces. Hosted policy must export machine-readable metadata that v1 tooling can read — no second hidden command contract.

### V2D: coordinated publishing and rollback

Coordinate package-manager publishing and rollback from hosted release records. Registry mutation remains explicit and auditable; hosted execution re-verifies artifact hashes before mutation. Local v1 publishing must keep working without the hosted service.

### V2E: enterprise administration

Organizations, teams, roles, service accounts. Billing, retention, export/deletion policies. Scoped API keys. Support and compliance posture.

## Prerequisites V2 inherits from V1

V2 builds on these stable v1 outputs:

- Product capability catalog with effects, policy, examples, auth requirements, surface membership.
- Generated CLI/MCP/docs/agent/discovery artifacts with drift checks.
- Auth/session metadata that is useful without exposing credentials.
- Telemetry event schema, redaction policy, sink contract, release-manifest disclosure.
- Diagnostics output for install, auth, session, update, release, agent-readiness failures.
- Release manifest, package artifact records, publisher receipts, provenance, channels, yanks, rollback plans.
- External package-consumer stability for all public packages.

If these are not stable, V2 becomes a dashboard over unstable internals. That is the wrong order.

## Non-goals

- A `release-extra` package. Renderer selection is configuration inside `@liche/releases`, not a package boundary.
- An npm-only release architecture.
- Framework-specific Vite/TanStack packages.
- A broad OpenAPI importer.
- Generated docs as a shipped package or command.
- Product-specific surface adapters (e.g., `wrangler.jsonc`, Workers Binding RPC metadata, dashboard metadata, generated server/API code) without explicit requirements.
- A single top-level `li` CLI as a release centerpiece. `liche-product` and `liche-build` already own their jobs; any repo-wide operator command should be defined as a Product schema and generated.
- V2 must not require users to build generated CLIs on liche-hosted infrastructure.
- V2 must not make hosted telemetry mandatory.
- V2 must not store local session files, access tokens, refresh tokens, env values, selected local contexts, or raw authorization headers.
- V2 must not introduce a second schema format that competes with the v1 Product contract, release manifest, or generated catalog.
