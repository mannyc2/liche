# Docs rules

`docs/` holds the rewrite requirements and supporting notes. It is internal repo material only — not a package, command, API, or shipped feature.

Top-level files (`invariant.md`, `package-layout.md`, etc.) are authoritative requirements. `tests/` holds test plans that trace to a requirement.

## Reading order

Read these before editing rewrite implementation or tests:

1. `docs/invariant.md`
2. `docs/package-layout.md`
3. `docs/next-plan.md`
4. `docs/core-api-boundary.md`
5. `docs/core-simplification-plan.md`
6. `docs/application-integration.md`
7. `docs/product-schema.md`
8. `docs/config-primitive.md`
9. `docs/auth-session.md`
10. `docs/http-operation-transport.md`
11. `docs/schema-ir-openapi.md`
12. `docs/server-conformance.md`
13. `docs/build-system.md`
14. `docs/distribution.md`
15. `docs/npm-binary-packaging.md`
16. `docs/releases.md`
17. `docs/public-release.md`
18. `docs/v1-release-plan.md`
19. `docs/v2-platform-goals.md`
20. `docs/coverage-rewrite.md`
21. `docs/log.md`

`docs/coverage-current.md` and `docs/behavior-plan.md` describe the existing Bun-native core, not the rewrite.

## Claim traceability

Every supporting claim must trace to at least one of:

- a requirement file in `docs/`
- upstream documentation
- an explicit user instruction

Unsupported claims should be labeled as open questions, not converted into facts.

## Update workflow

When new context is added:

1. Update or add the affected requirement file.
2. Update the reading order above if the file set changes.
3. Append to `docs/log.md`.
4. Flag contradictions instead of silently resolving them.

## Test workflow

Before adding rewrite tests:

1. Find the requirement in `docs/`.
2. Add coverage to `docs/coverage-rewrite.md`.
3. State the known-bad implementation the test catches.

Never change expected test output to match current implementation unless the requirement changed first.

## Boundaries

Do not create:

- an `li docs` command
- a docs package
- a docs runtime dependency
- generated product docs from this directory without an explicit build requirement

`docs/` exists for agent continuity and requirement tracking only.
