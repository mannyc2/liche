# Shipyard CLI release example

This directory is a minimal production-shaped repository for a handwritten CLI:

- `src/cli.ts` defines a remote HTTP-backed deployment CLI with `@lili/core`.
- `shipyard.jsonc` is the project config file the CLI can read.
- `lili.releases.json` declares release metadata, binary hosting, and package ecosystems.
- `.github/workflows/release.yml` runs checks, tests, `li-release ship`, and the PyPA publish action.

The CLI exposes `shipyard deployments list` and `shipyard deployments promote <id>`.

In a real repository, replace the `acme/*` release targets with your GitHub repository, npm package, PyPI distribution, Homebrew tap, and Scoop bucket.

Local dry run:

```sh
bun install
bun run check
bun run test
bun run release:dry-run
```
