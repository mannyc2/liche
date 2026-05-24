# Support

Liche v1 is a Bun-native package suite. The supported runtime for package consumption is Bun `>= 1.3.0`.

## Public Support Matrix

| Area | V1 support |
|---|---|
| Runtime | Bun `>= 1.3.0` |
| Node package consumption | Unsupported in v1 |
| Published package format | TypeScript source and Bun entrypoints |
| Generated binary targets | The targets listed in each release manifest |
| Package managers | npm packages for the library suite; generated CLI wrappers can target npm, PyPI, Homebrew, and Scoop through `@liche/releases` |
| Hosted service dependency | None for v1 |

## Release-Candidate Support Gate

Before a release candidate is considered supportable:

```bash
bun run release:check
```

For live npm registry name status:

```bash
bun run --silent release:names
```

The live registry check is intentionally separate from `release:check` because package ownership and registry state are external facts.
