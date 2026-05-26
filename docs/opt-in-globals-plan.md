# Opt-in globals plan

## Goal

`@liche/core` must not reserve user-visible global flags unless the CLI author explicitly installs that behavior.

The baseline `defineCli({ commands })` contract is:

- no implicit `--format`, `--json`, `--schema`, `--llms`, `--help`, `--version`, `--full-output`, `--filter-output`, or token flags
- no `Global Options:` help section unless a global-contributing extension is installed
- command options may freely use names such as `format`, `version`, `schema`, and `json`
- agent-facing helpers are absent unless the author installs `agents()` or a narrower agent extension

Core may still own reusable primitives: command contracts, formatting functions, schema reflection, lifecycle events, help rendering, and extension lanes. The hard cutover is about flags and helper commands, not deleting the primitives.

## Current implementation status

The flag-ownership cutover is implemented:

- Core no longer injects implicit global flags into every CLI.
- Core exports explicit `help()`, `version()`, `outputControls()`, and `reflectionControls()` controls.
- `help({ renderer })` customizes explicit help, fallback help, and validation help through a serializable help model; `defaultHelpRenderer()` is public for wrappers.
- `--json` resolves through the same output-renderer registry as `--format`; custom format names require both a registered renderer and an explicit `outputControls({ format: true, formats: [...] })` control.
- `@liche/agents` owns `llms()` and includes it in `agents()`.
- Generated Product CLIs visibly install their chosen controls and no longer use `disabledGlobals`.
- Unknown command options now fail instead of being silently stripped by object schema parsing, which keeps uninstalled globals available as command option names when declared.

The remaining work is documentation polish and any future model fields users ask for; the renderer lane itself is implemented.

## Decisions

| Surface | New owner | Default behavior |
|---|---|---|
| `--help`, `-h` | opt-in core `help()` control | absent unless installed |
| no-args or group fallback help | core command-resolution behavior | still allowed because it does not reserve a flag |
| `--version` | opt-in core `version()` control | absent unless installed; `version` metadata remains available to contracts/events |
| `--json`, `--format`, `--full-output`, `--filter-output`, `--token-count`, `--token-limit`, `--token-offset` | opt-in core `outputControls()` control | absent unless installed; commands may still set default `format` |
| `--schema` | opt-in core `reflectionControls()` control | absent unless installed; generated/Product CLIs install it explicitly when desired |
| `--llms` | `@liche/agents` | installed by `agents()` by default |
| `--mcp`, MCP stdio/HTTP handlers | `@liche/agents` via `mcpServer()` | installed by `agents()` by default |
| `mcp add`, `skills add`, `skills list` | `@liche/agents` bundle over leaf installers | installed by `agents()` by default |
| `--config`, `--no-config` | `@liche/config` | absent unless config extension is installed |

`agents()` becomes the default agent bundle. Leaf helpers such as `mcpServer()`, `mcpInstaller()`, and `skillsInstaller()` remain available for authors who want a smaller surface.

Generated CLIs may choose opinionated controls, but generated source must install them explicitly. There should be no hidden generated-mode fallback that reintroduces implicit core globals.

## Target API shape

```ts
import {
  defineCli,
  help,
  outputControls,
  reflectionControls,
  version,
} from "@liche/core";
import { agents } from "@liche/agents";

export const cli = defineCli({
  name: "shipyard",
  version: "1.2.3",
  extensions: [
    help(),
    version(),
    outputControls({ json: true, format: true }),
    reflectionControls({ schema: true }),
    agents(),
  ],
  commands: [],
});
```

The names can change during implementation, but the contract cannot: a user-visible flag comes from an explicit extension/control.

## Help customization

Core should expose help customization without exposing `CliState`, `Entry`, parser internals, or the current source-path `renderHelp()` implementation.

Add a public help model and renderer lane:

```ts
type HelpModel = {
  aliases: string[];
  args: HelpField[];
  commands: HelpCommand[];
  description?: string;
  examples: HelpExample[];
  globals: HelpGlobal[];
  hint?: string;
  name: string;
  options: HelpField[];
  path: string[];
  usage: string[];
};

type HelpRenderer = (model: HelpModel, context: HelpRenderContext) => string;
```

`help({ renderer })` uses the supplied renderer for `--help`. The same renderer is also used by no-args/group fallback help, command-not-found help when applicable, and human validation diagnostics that include help text.

Core should export a default renderer, for example `defaultHelpRenderer(model, context)`, so users can wrap or lightly customize the built-in layout without copying internal state logic.

Customization requirements:

- section labels and ordering are customizable through the renderer
- the renderer receives only serializable contract-shaped data
- extension globals appear only when installed and visible
- command `hint`, `usage`, examples, aliases, env provenance, deprecation markers, and default values remain available in the model
- validation diagnostics do not bypass the configured renderer

## Implementation plan

1. Document and coverage gate
   - Add behavior rows for opt-in globals, standard output controls, reflection controls, agent controls, and custom help rendering.
   - Verify: docs point to tests that will fail against the current implicit-global implementation.

2. Normalize globals to explicit contributions
   - Change the global registry so it normalizes `definition.globals` and extension globals only.
   - Move the current `coreGlobalDefinitions()` entries into exported opt-in control factories.
   - Remove the `DisabledGlobal` model after generated CLIs are migrated; selective disable is no longer the right abstraction.
   - Verify: a minimal `defineCli()` has an empty global registry and help output has no `Global Options:` section.

3. Keep runtime behavior flag-gated
   - `serveCli()` must not branch on `flags.version`, `flags.schema`, `flags.llms`, or output-control flags unless the corresponding control contributed that flag.
   - Prefer `serveHandlers` for controls such as version, schema, llms, and mcp so extension ownership is visible.
   - Ensure `--help` is not special unless `help()` is installed. No-args/group fallback help may remain, but explicit unknown flags must not be mistaken for help.
   - Verify: `app --version` and `app --schema` are command input or parse errors unless their controls are installed.

4. Move agent controls to `agents()`
   - Move `--llms` handling and any skill/manifest rendering needed by that flag into the agents extension path.
   - Keep MCP stdio/HTTP and installer commands in the agents bundle by default.
   - Confirm interactive agent helper commands remain `interactive: true` so they do not appear as MCP tools.
   - Verify: core alone exposes no agent commands or agent globals; `agents()` exposes the expected agent surface.

5. Add help renderer API
   - Build `HelpModel` from command contracts and visible globals.
   - Route current help rendering through `defaultHelpRenderer(model, context)`.
   - Add `help({ renderer })` as the flag-owning control.
   - Update human validation error formatting to use the configured renderer.
   - Verify: a custom renderer changes root help, command help, fallback help, and validation help consistently.

6. Migrate first-party CLIs and generators
   - Update handwritten first-party CLIs to install only the controls they use.
   - Update Product-generated CLI output to explicitly install the generated control set.
   - Update examples, README snippets, golden snapshots, API snapshots, and package-boundary tests.
   - Verify: command options named `format` and `version` work in a consumer fixture without disabling anything.

7. Release-readiness proof
   - Run focused core and extension tests first, then generated Product tests and examples.
   - Run package-readiness checks and a temp-consumer smoke that imports `@liche/core`, builds a CLI with no globals, and separately builds one with `help()`, `outputControls()`, `reflectionControls()`, and `agents()`.
   - Verify: public package behavior matches docs and no implicit global appears in the packed consumer path.

## Test cases to add first

- Minimal CLI: `--format` is available as a command option and is not intercepted globally.
- Minimal CLI: `--version`, `--schema`, `--llms`, and `--json` are not recognized as globals.
- Minimal CLI: help output has no `Global Options:` section.
- `help()` control: `--help` and `-h` render help.
- Custom help renderer: custom text appears in root help, command help, fallback help, and validation diagnostics.
- `version()` control: `--version` prints the configured version; without it, `version` is only metadata.
- `outputControls()` control: `--json` and `--format` work only when installed.
- `reflectionControls()` control: `--schema` works only when installed.
- `agents()` control: `--llms`, `--mcp`, `mcp add`, and `skills add` are present; core-only CLI has none of them.
- Generated CLI: generated source visibly installs its selected controls.

## Compatibility stance

This is a breaking change. Do not add legacy aliases, implicit fallback globals, or a compatibility mode. The migration is a hard cutover because the whole point is to stop taxing adopters with reserved flags they did not ask for.
