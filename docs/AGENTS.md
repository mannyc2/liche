# Docs contribution guide

`docs/` holds requirement documents and supporting notes. It is internal repo material — not a package, command, API, or shipped feature. The package READMEs and root README are the public-facing documentation; this directory exists for agent continuity and requirement tracking.

## Reading order

Start here when reviewing a change to implementation or tests:

1. [invariant.md](./invariant.md) — product invariants, workspace layout, package boundaries.
2. [api-boundary.md](./api-boundary.md) — what's public in `@liche/core` and the decision rule for widening.
3. [core-run-and-arg-codecs-plan.md](./core-run-and-arg-codecs-plan.md) — planned public invocation APIs, strict Zod-backed CLI argument codecs, and the hard cutover that removes abstract safety/auth/agent vocabulary from Core.
4. [coverage.md](./coverage.md) — behavior cases, mutation priorities, and the requirement-to-test traceability matrix.

Then read the topic-specific requirement docs as needed:

- [application-integration.md](./application-integration.md) — capability-first integration for web apps.
- [product-schema.md](./product-schema.md) — `defineProduct` authoring and canonical catalog.
- [config-primitive.md](./config-primitive.md) — config declaration, discovery, provenance.
- [opt-in-globals-plan.md](./opt-in-globals-plan.md) — hard cutover plan for opt-in global flags and customizable core help.
- [research-request-core-api-internals.md](./research-request-core-api-internals.md) — research brief for improving `@liche/core` API and internals before public API freeze.
- [auth-session.md](./auth-session.md) — auth providers, sessions, OAuth device login.
- [env-vars.md](./env-vars.md) — env var contract.
- [http-operation-transport.md](./http-operation-transport.md) — outbound HTTP transport.
- [schema-ir-openapi.md](./schema-ir-openapi.md) — canonical IR and OpenAPI projection.
- [server-conformance.md](./server-conformance.md) — server conformance against owned HTTP deployments.
- [build-system.md](./build-system.md) — schema authoring, generation, compile.
- [distribution.md](./distribution.md) — release manifest schema and binary targets.
- [npm-binary-packaging.md](./npm-binary-packaging.md) — npm umbrella/platform package details.
- [release-and-distribution.md](./release-and-distribution.md) — renderer architecture, versioning, publish path.
- [error-handling.md](./error-handling.md) — error model in core.

Project direction lives in [ROADMAP.md](../ROADMAP.md) at the repo root. Release history lives in [CHANGELOG.md](../CHANGELOG.md).

## Claim traceability

Every supporting claim in these docs must trace to at least one of:

- a requirement file in `docs/`
- upstream documentation (linked)
- an explicit user instruction

Unsupported claims should be labeled as open questions, not converted into facts.

## Update workflow

When new context is added:

1. Update or add the affected requirement file.
2. Update [coverage.md](./coverage.md) if the change affects behavior covered by a test, or adds a behavior that needs one.
3. Append to [CHANGELOG.md](../CHANGELOG.md) under `## Unreleased` for user-visible changes.
4. Flag contradictions instead of silently resolving them.

## Test workflow

Before adding tests:

1. Find the requirement in `docs/`.
2. Add coverage to [coverage.md](./coverage.md).
3. State the known-bad implementation the test catches.

Never change expected test output to match current implementation unless the requirement changed first.

## Boundaries

Do not create:

- an `li docs` command
- a docs package
- a docs runtime dependency
- generated product docs from this directory without an explicit build requirement

This directory exists for agent continuity and requirement tracking only.
