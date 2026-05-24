# Core simplification plan

This records the hard-cut simplification of `@liche/core` by moving optional CLI surface into standardized extensions.

## Goal

Make `defineCli({ ... })` describe the command graph and required runtime lanes only. Optional features should be explicit extensions, not bespoke top-level fields or hidden helper commands.

Success means:

- `@liche/core` can run a handwritten CLI with `defineCli({ name, commands })` and no hidden helper command surface.
- Optional behavior is composed through one extension lane.
- Core has no dependency on an extension package.
- Package-consumer tests prove generated/Product code depends only on the approved core root API.
- Disabling an extension leaves command execution, JSON/JSONL output, provenance, structured errors, auth/session resolution, and outbound HTTP transport behavior unchanged.

## Pre-cutover contradiction

The pre-cutover implementation treated two optional concepts as first-class core construction fields:

- `DefineCliOptions.builtins` controls `completions`, `config doctor`, `mcp add`, `skills add`, and `skills list`.
- `DefineCliOptions.config` declares typed config directly on the CLI.

That was coherent for the previous "core owns the primitive" direction, but it no longer matches the simplification goal. The cutover target is: core owns the runtime lanes and parser/provenance semantics; extension factories own optional authoring and helper command surface.

## Recommended decisions

### 1. Add `@liche/extensions`

Create one optional first-party package for official extension factories.

Opt-in sentence:

```txt
Install @liche/extensions when you want official optional CLI extensions such as config authoring, completions, MCP/skill installers, local diagnostics, or telemetry sinks. Without it, @liche/core still runs authored commands.
```

Do not create one npm package per helper. Start with one package because the boundary is "official optional adapters over stable liche contracts", not "miscellaneous things not in core".

Use package subpath exports inside `@liche/extensions` for individual lanes:

```txt
@liche/extensions
@liche/extensions/agents
@liche/extensions/auth
@liche/extensions/config
@liche/extensions/completions
@liche/extensions/mcp
@liche/extensions/skills
@liche/extensions/support
```

The package root may re-export the stable, low-dependency factories for convenience. Subpath exports are the default import style in docs and generated code because they keep dependencies and ownership visible without fragmenting the install story.

`@liche/extensions/agents` is the coordinated agent-facing lane. It may bundle MCP installer, skill installer, `--llms`/skill content helpers, and agent readiness checks for handwritten CLIs. The leaf subpaths remain available when a CLI wants only one piece, such as just `mcpInstaller()` or just `skillsInstaller()`.

`@liche/extensions/auth` owns auth/session workflows that are optional for handwritten CLIs and only imported by generated CLIs when the Product catalog declares auth. Core keeps security-sensitive primitives that affect command execution and transport correctness, but does not own login/session/provider UX.

Promote a subpath to a separate package only when it has a different opt-in sentence, heavy or platform-specific dependencies, independent release cadence, or a third-party ecosystem integration that should not ship with the official extension bundle.

### 2. Export extension protocol from core, not extension implementations

`@liche/core` should expose the minimal public protocol needed by `defineCli()`:

```ts
type CliExtension = {
  id: string;
  commands?: readonly DeclarativeCommand[] | undefined;
  config?: ConfigDefinition | undefined;
  events?: readonly CliEventRegistration[] | undefined;
  globals?: readonly GlobalInputDefinition[] | undefined;
  hooks?: CliHookRegistration | undefined;
  middleware?: readonly MiddlewareHandler[] | undefined;
  skill?: SkillDefinition | undefined;
};
```

`defineCli()` accepts `extensions?: readonly CliExtension[]`.

Global inputs are a core CLI concern, not an extension-only concept. CLI authors should be able to declare shared flags directly on `defineCli()` without creating an extension; extensions should plug into the same registry.

```ts
type GlobalInputDefinition = {
  alias?: string | undefined;
  deprecated?: boolean | string | undefined;
  description?: string | undefined;
  expose?: "context" | "runtime" | undefined;
  flag?: string | undefined;
  hidden?: boolean | undefined;
  key: string;
  type: "boolean" | "string";
  valueLabel?: string | undefined;
};

const profile = defineGlobal({
  key: "profile",
  type: "string",
  valueLabel: "name",
  description: "Profile to use",
  expose: "context",
});

defineCli({
  name: "shipyard",
  globals: [
    profile,
    { key: "nonInteractive", flag: "non-interactive", type: "boolean" },
  ],
  commands: [],
});
```

`defineGlobal(...)` is the core helper for reusable globals and TypeScript narrowing. Object literals remain valid in `defineCli().globals`; the helper just normalizes defaults such as `flag: kebab(key)`, freezes the definition, and gives extension authors the same construction shape as app authors. Do not add a separate `global.string(...)` / `global.boolean(...)` DSL until the plain object shape proves insufficient.

Global definitions describe parse, help, validation, and context projection only. They must not load config, resolve auth, mutate sessions, run hooks, or perform side effects.

Status: landed as the core global-input slice. Generated auth CLIs install `auth()` from `@liche/extensions/auth` so `--profile`, `--no-session`, and `--non-interactive` are extension-provided globals rather than hard-coded parser cases or Product-owned inline declarations.

Core should not export `Extensions`, `Completions`, `McpInstaller`, or similar implementation namespaces. If TypeScript inference needs a helper, add a tiny `defineExtension(...)` value export; otherwise keep this type-only.

### 3. Remove `builtins`

Delete `DefineCliOptions.builtins` and `BuiltinsConfig`.

Each helper becomes an extension factory:

- `completions()` registers `completions`.
- `configDoctor()` registers `config doctor`.
- `mcpInstaller()` registers `mcp add`.
- `skillsInstaller()` registers `skills add` and `skills list`.

There should be no default helper commands. A plain `defineCli({ name, commands })` should expose only authored commands plus core-owned help/version/global behavior.

### 4. Remove top-level `config`

Delete `DefineCliOptions.config` as an author-facing construction field.

Keep config resolution semantics in core because config affects parser order, option provenance, command defaults, generated remote base URLs, and `ctx.sources`. Move the authoring entrypoint to an extension:

```ts
import { defineCli, defineCommand, z } from "@liche/core";
import { config } from "@liche/extensions";

defineCli({
  name: "shipyard",
  extensions: [
    config({
      files: ["shipyard.jsonc", "shipyard.yaml"],
      schema: z.object({
        apiBaseUrl: z.string().url(),
      }),
    }),
  ],
  commands: [
    defineCommand({
      path: ["deploy"],
      input: {
        config: { apiBaseUrl: "apiBaseUrl" },
      },
      run({ ctx }) {
        return { baseUrl: ctx.config["apiBaseUrl"] };
      },
    }),
  ],
});
```

This removes config as a special construction field without pretending config can be implemented outside the parser/runtime.

### 5. Keep direct MCP execution in core

Direct MCP runtime projection over the command contract can stay in core because it shares executor internals and command invocation semantics. Installer UX such as `mcp add`, provider-specific config files, bundles, and publishing belongs in `@liche/extensions` or later adapter packages.

### 6. Move local support utilities out of core root

`createLocalTelemetrySink` and `runLocalDoctor` should move behind extensions unless a package-root consumer proves they are required runtime primitives. They are support workflows, not command execution semantics.

### 7. Split auth runtime from auth workflows

Auth should not remain one broad core-owned bucket.

Core keeps the pieces that affect command and transport safety:

- `secret()` / `SecretString` as a general redaction primitive.
- Non-secret auth requirement metadata on `CommandContract`.
- Invocation posture and global-input plumbing needed by generated/runtime commands.
- Structured error envelopes and redaction rules.
- HTTP transport support for already-resolved auth or concrete headers.

`@liche/extensions/auth` owns the optional auth workflow:

- `resolveAuth(...)`
- `resolveContext(...)`
- `SessionStore` and `createFileSessionStore(...)`
- OAuth device login
- `whoami`, `switch`, `logout`, and related auth command factories
- env/session token source resolution
- identity probing
- later keychain, refresh-token, and provider-specific behavior

Generated Product CLIs import `@liche/extensions/auth` only when the normalized catalog needs auth runtime behavior. Products with no auth should not import the auth extension.

## Package responsibilities after the cut

### `@liche/core`

Owns:

- command declaration and execution
- parser/env/config resolution engine
- global input registry and `ctx.global` projection
- result envelope and structured errors
- lifecycle events, mutation hooks, middleware
- `CommandContract`
- direct MCP execution over command contracts
- redaction and auth metadata primitives
- outbound HTTP operation transport
- extension protocol and extension merge rules

Does not own:

- helper command factories
- completions command UX
- config doctor UX
- auth/session resolution UX
- MCP/skill installer UX
- telemetry sink presets
- local support bundle/doctor workflows

## Cutover map

| Area | Stays in `@liche/core` | Moves to `@liche/extensions` |
|---|---|---|
| CLI authoring and execution | `defineCli`, `defineCommand`, `.serve()`, `.fetch()`, command selection, validation, middleware, lifecycle events, hooks, result envelopes, structured errors | none |
| Global inputs | core-owned global input registry, direct `defineCli().globals` authoring, parser/help/context projection, collision checks, disabled-state invariants | extension-provided global declarations plug into the same registry |
| Extension composition | `CliExtension` protocol and merge rules for commands, globals, config, events, hooks, middleware, and skill content | extension factories and bundles |
| Config | config resolution engine, file parsing, precedence, provenance, `ctx.config`, `ctx.sources`, explicit option-to-config binding semantics | `config(...)` authoring factory, `configDoctor()`, config inspection/mutation UX |
| Helper commands | help/version/global behavior that every CLI needs | `completions()`, `mcpInstaller()`, `skillsInstaller()`, helper bundles |
| Agents | direct MCP runtime execution over `CommandContract`; agent-safe result/error envelopes | `agents()` bundle, agent readiness checks, skill installer, MCP installer, provider/client setup UX |
| Auth | `secret()` / `SecretString`, non-secret auth metadata, invocation posture, redaction, transport-safe auth/header application contract | `auth(...)` workflow extension, `resolveAuth`, `resolveContext`, sessions, OAuth device login, whoami/switch/logout, identity probing |
| HTTP transport | request serialization, remote error normalization, output validation, timeout/network/status handling | provider credential resolution and login/session flows |
| Support and telemetry | local event and hook lanes; redacted event shape | telemetry sink presets, local doctor/support bundle commands |
| Product surfaces | no Product catalog generation in core | Product imports extensions only for required runtime surface; Product-owned MCP/docs/Agent artifacts stay in `@liche/product` |

### `@liche/extensions`

Owns official optional extensions that consume public core lanes:

- agent-facing helper bundle
- auth/session workflow extension
- config authoring factory
- completions command
- config doctor command
- MCP installer command
- skill installer command
- local diagnostics and telemetry sink adapters

Uses subpath exports to keep each lane independently importable while staying one published package until a real package-boundary reason appears.

Must not import `packages/core/src/*`, mutate `CliState`, or depend on Product/Build/Releases internals.

### `@liche/product`

Generated CLIs use `@liche/extensions` only when the catalog requires optional runtime surface such as auth/session resolution, config-backed remote base URLs, generated local support commands, or explicit agent setup commands. Product-owned generated MCP/docs/Agent surfaces stay Product outputs, not core extensions.

## Implementation slices

1. Extension protocol in core.
   Status: first slice landed for commands, config, events, hooks, middleware, and skill composition. Global-input declarations remain the next core protocol slice before auth can move.
   Verify: an extension-lane test composes commands, config, events, hooks, and middleware through `defineCli({ extensions })` using only package-root imports.

2. Core global inputs.
   Status: landed for `defineGlobal(...)`, direct `defineCli().globals`, extension-provided globals, registry-backed help/parser/context projection, duplicate-global rejection, auth-extension globals, and disabled `--format` help omission.
   Verify: `defineGlobal(...)` and object-literal `defineCli().globals` both feed the same normalized registry as `CliExtension.globals`; parser acceptance, help output, duplicate-global rejection, disabled globals, and `ctx.global` are generated from that registry; globals do not appear in MCP tool input schemas.

3. Create `@liche/extensions`.
   Status: landed with root exports plus `@liche/extensions/agents`, `@liche/extensions/auth`, `@liche/extensions/config`, `@liche/extensions/completions`, `@liche/extensions/mcp`, `@liche/extensions/skills`, and `@liche/extensions/support`.
   Verify: package boundary tests prove `@liche/core` does not depend on it, while `@liche/extensions` imports only `@liche/core` package-root APIs.

4. Move helper commands.
   Status: landed. `DefineCliOptions.builtins` and `BuiltinsConfig` are gone; `completions()`, `agents()`, `mcpInstaller()`, and `skillsInstaller()` own the helper commands.
   Verify: default `defineCli({ name, commands })` has no `completions`, `config doctor`, `mcp add`, or `skills add`; adding the matching extension restores the command and keeps existing behavior.

5. Move config authoring.
   Status: landed. `defineCli({ config })` is no longer an author-facing field; `config(...)` contributes the core config declaration through the extension lane and `configDoctor()` owns the command UX.
   Verify: `--config` and `--no-config` are rejected without the config extension; config-backed option binding and provenance still work with the extension.

6. Move auth workflows.
   Status: landed. `@liche/extensions/auth` owns `resolveAuth`, `resolveContext`, file sessions, OAuth device login, and generated auth command helpers. Core keeps `secret()`, `applyAuth()`, auth metadata, invocation posture, redaction, and transport-safe auth application.
   Verify: auth-free generated CLIs import no auth extension; auth-enabled generated CLIs import `@liche/extensions/auth`; `resolveAuth`, sessions, OAuth device login, and generated auth commands keep current behavior while auth globals come from the extension.

7. Update Product/Build/Releases/examples.
   Status: landed for package CLIs, examples, generated fixtures, package-consumer snapshots, and public-package readiness gates. Product imports config/support/auth extensions only when the normalized catalog needs them.
   Verify: generated Product CLIs import `@liche/extensions` only when needed; handwritten examples show explicit extension composition; package-consumer API snapshots are updated.

8. Re-freeze core API.
   Status: landed. `@liche/core` root no longer exports `createConfig`, `BuiltinsConfig`, `createLocalTelemetrySink`, `runLocalDoctor`, or auth workflow/session helpers.
   Verify: `createConfig`, `BuiltinsConfig`, `createLocalTelemetrySink`, `runLocalDoctor`, auth workflow helpers, and helper-command implementation exports are absent from `@liche/core` root unless a failing package-root consumer proves otherwise.

## Open questions

- Should `ctx.config` remain always present as `{}` for CLIs without the config extension, or should the type contract model config-enabled CLIs separately?
- Should `skillsInstaller()` generate reflected skill content from `CommandContract`, or keep requiring explicit packaged skill content until a public contract-rendering helper exists?
