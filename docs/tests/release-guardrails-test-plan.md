# Test plan: release guard rails

Authoritative sources: `docs/distribution.md`, `docs/releases.md`, `docs/npm-binary-packaging.md`, `docs/next-plan.md`, `docs/coverage-rewrite.md`.

## Priority order

1. Manifest schema validation.
2. Product/catalog and runtime provenance.
3. Conformance report metadata when release policy requires it.
4. Final binary hash and size.
5. npm package rendering.
6. Final `.tgz` verification.
7. Renderer purity.
8. Yank dry run.
9. Target normalization and package artifact records.
10. Extra renderers when justified.

## Renderer-neutral first

The first release slice is the manifest, binary verification, renderer registry, renderer selection, and final-artifact verification loop.

npm can be an early renderer because its umbrella/platform optional dependency pattern is a useful fixture, but it must not become the package boundary or the only path through the release code. The test plan must also cover `renderers: []` so manifest-only release verification is valid.

The Phase 5 implementation uses fake renderers inside `packages/releases/test/` so the release package proves the shared contract before ecosystem details arrive.

## Phase 5 implementation tests

| Test file | Requirement IDs | Must prove | Known-bad implementation caught |
|---|---|---|---|
| `packages/releases/test/manifest.test.ts` | `RELEASE-001`, `RELEASE-002`, `RELEASE-003` | Manifest schema validates metadata, executable metadata, subject/contract provenance, runtime env/config, conformance metadata, and binary target entries. | Renderer accepts invalid or untraceable manifest data. |
| `packages/releases/test/binary.test.ts` | `RELEASE-004` | Hash and size are computed from final binary bytes after a simulated signing mutation. | Release hashes pre-signing bytes or ignores size drift. |
| `packages/releases/test/target-normalization.test.ts` | `RELEASE-018` | Exact Bun target strings agree with normalized platform, arch, libc, and cpu variant fields. | Release matrix silently labels a baseline/musl artifact incorrectly. |
| `packages/releases/test/renderer-selection.test.ts` | `RELEASE-009`, `RELEASE-012`, `RELEASE-020` | Empty, one, many, and all selections work; unsupported or underconfigured selected renderers fail before staging; absent publisher credentials do not block rendering. | npm-only control flow, implicit all-renderer behavior, or credential checks mixed into renderer selection. |
| `packages/releases/test/release-package.test.ts` | `RELEASE-009`, `RELEASE-012`, `RELEASE-019`, `RELEASE-020` | The orchestration path validates the manifest, verifies binaries, invokes a fixture renderer with manifest data plus verified binary records, packs artifacts, records verified artifact metadata, and verifies the packed output. | Renderer reads product schema/build workspace state, omits artifact records, or verifies only staging directories. |
| `packages/releases/test/yank.test.ts` | `RELEASE-010` | Yank dry run derives affected artifacts from one manifest reference. | Yank requires ad hoc package names or ecosystem-specific manual input. |
| `packages/releases/test/package-boundary.test.ts` | `RELEASE-013` | `@lili/releases` has no runtime dependency on `@lili/core`, `@lili/build`, or `@lili/product`; build output is consumed as data; concrete renderers stay behind renderer subpath exports. | Release code reaches around the manifest into build/core/product internals, or the root export pulls every renderer implementation. |
| `packages/releases/test/ecosystem-renderers.test.ts` | `RELEASE-005`, `RELEASE-006`, `RELEASE-007`, `RELEASE-008`, `RELEASE-011`, `RELEASE-019` | npm/PyPI/Homebrew/Scoop renderers produce package artifacts from one manifest plus verified binary records; npm tarballs, PyPI wheels, Homebrew formulae, and Scoop JSON are inspected. | Renderer emits invalid package-manager artifacts, accepts lifecycle scripts, loses binary hashes, or only verifies staging directories. |

## Fixture rules

- Use temporary files with synthetic executable bytes; do not require a real Bun-compiled binary for guard-rail tests.
- Simulate signing by mutating bytes before manifest hash calculation, then mutate again to assert verification failure.
- Keep fixture renderers inside tests. They may pack a simple final artifact, but they must not become npm package scaffolding.
- Fixture renderer outputs must include verified artifact records with renderer, ecosystem, kind, version, sha256, and size.
- Do not import `@lili/core`, `@lili/build`, or `@lili/product` from `@lili/releases` tests except from the explicit package-boundary test that proves they are absent.

## Publishing automation tests

Publishing automation is planned after renderer artifacts exist. These tests should not be added to Phase 5.

| Test file | Requirement IDs | Must prove | Known-bad implementation caught |
|---|---|---|---|
| `packages/releases/test/publish-plan.test.ts` | `RELEASE-014` | A dry-run plan derives npm, PyPI, Homebrew, and Scoop mutations from one manifest plus verified artifact records. | Publisher requires ad hoc package names, versions, or workspace reads. |
| `packages/releases/test/publish-preflight.test.ts` | `RELEASE-015` | Selected publishers fail on missing credentials or repository settings before mutation; unselected publishers are ignored. | Partial publishes happen before config errors surface. |
| `packages/releases/test/publish-artifacts.test.ts` | `RELEASE-016` | Artifact hashes are rechecked immediately before publish. | Stale or tampered packed artifacts are uploaded. |
| `packages/releases/test/npm-publish-order.test.ts` | `RELEASE-017` | npm platform packages publish before the umbrella package. | Users can install the umbrella before optional platform packages exist. |
| `packages/releases/test/provenance.test.ts` | `RELEASE-021` | npm/PyPI/GitHub provenance metadata can be recorded when configured, but sha256 verification still gates publish. | Attestation metadata is treated as a substitute for artifact verification. |

## Final artifact rule

Never accept a staging directory verification as the final proof.

For the shared Phase 5 spine, verify final artifact file bytes against package records. For ecosystem renderers, pack the artifact, unpack it, inspect it, and hash the binary bytes inside the packed artifact.
