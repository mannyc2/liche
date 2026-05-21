# lili

A Bun-native, small-dependency, LLM-friendly CLI core.

## Rewrite planning docs

The current package is the Bun-native core implementation. The planned rewrite is documented before implementation in:

```txt
docs/invariant.md
docs/package-layout.md
docs/next-plan.md
docs/application-integration.md
docs/config-primitive.md
docs/http-operation-transport.md
docs/schema-ir-openapi.md
docs/server-conformance.md
docs/build-system.md
docs/distribution.md
docs/npm-binary-packaging.md
docs/releases.md
docs/v1-release-plan.md
docs/v2-platform-goals.md
docs/coverage-rewrite.md
```

See `docs/AGENTS.md` for doc rules and update workflow.

Key planning decisions:

- `@lili/core` owns the runtime CLI framework, opt-in config primitive, and outbound HTTP operation transport.
- `@lili/product` owns Product schema authoring, general config and binding declarations, catalog normalization, lints, generated CLI/OpenAPI/MCP/docs/Agent Skill surfaces, drift checks, and server conformance.
- `@lili/build` owns reusable Bun build/compile primitives for standalone executables, including compile flag profiles and path-independent compile provenance.
- `@lili/releases` owns the release manifest, renderer interface, selectable renderers, and final-artifact verification.
- There is no `release-extra` package; npm, PyPI, Homebrew, and Scoop are renderer choices inside `@lili/releases`.
- OpenAPI is generated output, not MVP input.
- The internal docs is repo-internal only.
- V1 should publish the self-contained package toolchain; V2 is the hosted service/platform layer and must not block package publication.

## Runtime dependencies

```txt
@toon-format/toon  exact TOON encode/decode behavior
tokenx             token count and token slicing
yaml               YAML config/output behavior
zod                public schema API and JSON Schema generation
```

## Bun-native edges

The implementation keeps platform/runtime work at Bun edges:

- `Bun.argv` for default CLI args.
- `Bun.env` for environment input.
- `Bun.file` and `Bun.write` for config and sync files.
- Bun Shell for `mkdir -p` when available.
- Bun stdin/stdout for MCP stdio and CLI output.
- `bun:test` for the test runner.

## Layout

```txt
src/
  cli/          create, serve, fetch, execution, builtins
  command/      registry, resolution, schema/manifest helpers
  parser/       globals, argv/options, config loading
  schema/       Zod adapter and JSON Schema conversion
  format/       TOON, JSON, JSONL, YAML, markdown, filters, tokens
  mcp/          minimal JSON-RPC stdio/http implementation
  skills/       skill markdown generation and sync helpers
  runtime/      Bun-native IO/process edge functions
```

The current core behavior plan lives in `docs/behavior-plan.md`. Current core tests should be written from that plan.

Rewrite tests should be written from the rewrite requirement docs and tracked in `docs/coverage-rewrite.md`.

## Scripts

```sh
bun test
bun test test/property.test.ts --rerun-each=3 --randomize
bun run check
bun run mutate
```

`bun run mutate` uses Stryker's command runner to invoke `bun test`.
