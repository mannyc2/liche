# Re-Freeze Trigger Taxonomy

Status: evidence note, not a new requirement. This explains why the public surface kept widening and how to decide future widening requests without re-litigating the whole framework direction.

## Method

I audited `docs/log.md`, `docs/core-api-boundary.md`, `docs/config-primitive.md`, `docs/invariant.md`, and `docs/v1-release-plan.md` for entries described as a freeze, re-freeze, hard cutover, public addition, or boundary widening. I grouped each event by the missing lane that forced the change.

The result is not "no more changes." The result is a review rubric: a future proposal should name its trigger category first, then prove whether an existing public lane can handle it.

## Trigger Table

| Event | Trigger | Resolution | What prevents repetition |
|---|---|---|---|
| Phase 2 core boundary freeze | The package root exposed state-shaped namespaces and legacy builder assumptions before generated code started importing core. | Shrunk `packages/core/src/index.ts`, removed internal namespaces from the root, and added API snapshot plus package-consumer boundary tests. | Keep generated and external code on package-root imports only. Do not promote white-box test imports. |
| Declarative authoring re-freeze | Fluent `Cli.create().command()` semantics could not be analyzed into a stable manifest without builder execution. | Hard-cut to `defineCli()` / `defineCommand()` and serializable `CommandContract` records. | New handwritten and generated CLIs must start from declarative data; no legacy builder compatibility lane. |
| Packaged skills re-freeze | CLIs needed authored agent guidance without Product-generated surfaces or runtime reflection owning every skill document. | Added `DefineCliOptions.skill` and `SkillDefinition`. | Provider/client-specific installation workflows stay adapter work; core only carries packaged content and narrow opt-in install. |
| V1 supportability re-freeze | Observability, telemetry, diagnostics, and local policy checks needed a public extension lane instead of internal state access. | Added declarative lifecycle `events`, mutation `hooks`, and construction-time `middleware`. | `packages/core/test/extension-lane-coverage.test.ts` now proves representative optional features can stay outside core. |
| Phase 3 envelope re-freeze | Generated CLIs needed stable machine envelopes, arbitrary metadata, and generated-only global flag rejection. | Added `DefineCliOptions.generated`, `DisabledGlobal`, and widened `ResultMeta`. | Future generated-runtime policy should be expressed as reusable generated options, not hidden parser mutations. |
| Auth/session 3D-A re-freeze | Generated remote-operation CLIs needed shared credential/context resolution, redaction, and invocation posture. | Added `secret`, `resolveAuth`, `resolveContext`, `applyAuth`, `RunContext.invocation`, and structured auth details. A later minimization pass deleted the test-only `authMetaFromCredential` / `ResolvedAuthMeta` pair because generated/package consumers did not need it. | Auth stays in core only where it changes command safety/security semantics. Application auth commands remain generated/application-level. |
| Auth/session 3D-B/C re-freeze | Session profiles, explicit login/logout/whoami/switch, OAuth device login, and profile globals needed one runtime contract. | Added file session store, auth command helpers, OAuth/identity helpers, global auth options, and session types. | Stored sessions are auth state, not general config. Normal commands still never start implicit login. |
| Phase 4-A HTTP transport freeze | Product-generated remote commands and conformance needed shared serialization, auth application, timeout/status/schema error semantics. | Added `serializeHttpOperationRequest`, `callHttpOperation`, and HTTP operation types. | Product adapters generate data into the transport primitive; they do not duplicate parser/auth/error behavior. |
| Config primitive re-freeze | Generated remote base URLs needed typed durable config, explicit option binding, strict validation, and provenance. | Added `Config.object`, `ctx.config`, `ctx.sources`, config scopes, discovery, and explicit option-to-config bindings. | General config stays data-only and opt-in; auth/session state stays outside the durable config ladder. |
| Agent recovery error widening | Agents needed machine-readable recovery actions instead of scraping error messages. | Added Problem Details-shaped `CommandError` fields and recovery extensions (`retry_after`, `suggested_fix`, `code_actions`). | Treat future error fields as envelope evolution, not separate helper APIs, unless an agent benchmark proves another recovery lane is needed. |
| MCP metadata parity | MCP tools were weaker than the command contract/Product catalog could describe. | Core `tools/list` now includes output schemas; Product-generated MCP tools include MCP-standard hint annotations. | Manifest/MCP output should be a projection of existing command/catalog metadata, not a separate authoring surface. |

## Clusters

Most re-freezes fall into four trigger clusters:

| Cluster | Events | Read |
|---|---:|---|
| Missing extension lane | 2 | Lifecycle events/hooks/middleware were the real gap. The new extension-lane property test should stop most optional-feature debates. |
| Missing generated-runtime primitive | 4 | Envelope mode, auth/session, HTTP transport, and config provenance are command semantics. These are valid core concerns because generated CLIs cannot preserve behavior without them. |
| Missing metadata or envelope fields | 3 | Command contracts, MCP metadata, and structured errors are agent-discovery quality issues. They should be handled by enriching existing serializable contracts. |
| Public surface cleanup | 1 | The Phase 2 freeze was a corrective shrink, not feature growth. This should remain rare. |

## Decision Rule

Future public-surface widening should follow this order:

1. Try to implement the feature as an extension using package-root APIs, lifecycle events, hooks, middleware, config, command contracts, Product catalog artifacts, generated OpenAPI, or release/build records.
2. If that works, keep it outside core and add a disabled-state test.
3. If it fails because the extension must import internals, mutate hidden runtime state, eagerly import implementation modules, or duplicate parser/executor/security/provenance behavior, add a failing extension-lane test that demonstrates the missing reusable lane.
4. Widen core only by adding that reusable lane. Do not add one-off helper commands as the widening.

## Current Read

The project does have direction: declarative command contracts, schema-backed I/O, envelope output for generated CLIs, first-class config, opt-in helpers, and agent-readable metadata. The fatigue came from repeated narrow widenings before the extension lane was executable.

The next boundary decision should not start with "core or plugin?" It should start with "which stable contract does this consume, and does the extension-lane test pass?"
