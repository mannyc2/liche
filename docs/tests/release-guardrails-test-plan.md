# Test plan: release guard rails

Authoritative sources: `docs/distribution.md`, `docs/coverage-rewrite.md`.

## Priority order

1. Manifest schema validation.
2. Schema and runtime provenance.
3. Conformance report metadata when release policy requires it.
4. Final binary hash and size.
5. npm package rendering.
6. Final `.tgz` verification.
7. Renderer purity.
8. Yank dry run.
9. Extra renderers when justified.

## Renderer-neutral first

The first release slice is the manifest, binary verification, renderer registry, renderer selection, and final-artifact verification loop.

npm can be an early renderer because its umbrella/platform optional dependency pattern is a useful fixture, but it must not become the package boundary or the only path through the release code. The test plan must also cover `renderers: []` so manifest-only release verification is valid.

## Final artifact rule

Never accept a staging directory verification as the final proof.

Pack the artifact, unpack it, inspect it, and hash the binary bytes inside the packed artifact.
