# Research request: first-class CLI config primitive

## Context

We are building a TypeScript library suite for authoring CLIs.

The current package split is:

| Package | Responsibility |
|---|---|
| `@lili/core` | Runtime primitives for handwritten CLIs: command registration, parsing, env validation, output formatting, fetch/MCP serving, generated-code runtime helpers. |
| `@lili/product` | Product schema authoring and compiler: normalize product resources, workflow commands, auth/context declarations, bindings, and generated surfaces such as CLI, OpenAPI, MCP tools, Agent references, docs, and config schema. |
| `@lili/build` | Bun compile primitives and build records for executable output. |
| `@lili/releases` | Release manifest, binary verification, ecosystem package renderers, and publisher planning. |

We are revisiting config as a first-class primitive.

Current state:

- `@lili/core` already has a low-level config hook with `files`, `flag`, and `loader`.
- Core accepts global `--config <path>` and `--no-config`.
- Core can load JSON/YAML config and merge command options using the current precedence:

```txt
argv flag > optionEnv > config file > schema default
```

- The current config file shape for command options is implementation-shaped:

```json
{
  "commands": {
    "deploy": {
      "options": {
        "dryRun": true
      }
    }
  }
}
```

- `@lili/product` currently has `.binding({ key, fields })`, and generated config schema is binding-derived only. This is useful for product-specific structured bindings such as Workers `kv_namespaces`, but it does not cover normal CLI config needs like `baseUrl`, `timeoutMs`, `defaultOrg`, project root, profile defaults, output preferences, telemetry posture, update channel, or release defaults.

Working thesis:

```txt
Config is a core CLI primitive.
Product can provide a higher-level authoring abstraction that compiles down to core config.
Bindings are product-specific config declarations, not the whole config model.
```

We need external evidence before locking the API.

## Primary question

How should `@lili/core` expose an opt-in, first-class config primitive for CLI authors, and how should `@lili/product` layer product-schema abstractions on top of it?

The answer should recommend one concrete direction for:

1. The core authoring API.
2. Runtime load/merge/validate behavior.
3. Config file discovery and explicit path behavior.
4. Precedence across argv, env-backed option defaults, config, schema defaults, and runtime/session state.
5. The boundary between durable non-secret config and auth/session/profile state.
6. The product-schema abstraction that should compile into the core primitive.

## Design constraints

The recommendation must preserve these boundaries unless the research finds strong evidence against them:

- Config is opt-in. A CLI with no config declaration should reject `--config <path>` with a clear parse error.
- Config is durable user/project/product preference, not secret/session state.
- Tokens, refresh tokens, active sessions, account identities, and stored credentials belong in auth/session primitives, not general config.
- Selected context defaults such as `defaultOrg` or `defaultProject` may be config, but active runtime session/profile state must remain separate.
- Env vars that act as option defaults should remain visible as env-backed option defaults. Env vars that are true ambient runtime requirements should remain `env` schema fields.
- Generated Product CLIs should not invent a second config system. Product config declarations should lower into the same core config primitive used by handwritten CLIs.
- Core must keep working for handwritten CLIs without requiring `@lili/product`.

## Research targets

Survey both framework-level APIs and real product CLIs.

### Frameworks and libraries

At minimum, research:

1. `yargs` config support.
2. `commander` and whether config is intentionally out of scope.
3. `oclif` config patterns and plugin/config directories.
4. `clipanion`.
5. `cac`.
6. `cosmiconfig`.
7. `unconfig` / `c12`.
8. `conf` and similar user-config stores.
9. Go `cobra` plus `viper`.
10. Rust `clap` plus common config crates such as `figment`, `config`, or `confy`.
11. Python `click` / `typer` patterns and common config helpers.

For each, answer:

- Is config a first-class primitive, a plugin/helper, or intentionally absent?
- Does the framework define config file discovery, or leave it to application code?
- Does it validate config through the same schema as CLI flags?
- Does it expose typed resolved config to handlers?
- Does it track source/provenance for each value?
- Does it support writing config, or only reading config?
- What are the ergonomics for simple handwritten CLIs?

### Product CLIs and tools

At minimum, research:

1. Git.
2. npm.
3. pnpm.
4. Yarn.
5. Cargo.
6. Docker.
7. Kubernetes `kubectl`.
8. GitHub CLI `gh`.
9. AWS CLI.
10. Terraform.
11. Vite.
12. Vitest.
13. ESLint flat config.
14. Prettier.
15. Biome.
16. Wrangler.
17. Astro.
18. Next.js.
19. Turborepo.
20. Nx.

For each, answer:

- What config files are discovered by default?
- Is there an explicit `--config` flag?
- Is there a `--no-config`, `--isolated`, `--no-defaults`, or equivalent escape hatch?
- What is the search order across project, workspace, user, and global scopes?
- Are config files JSON, YAML, TOML, INI, JS/TS, package metadata, or another format?
- Are dynamic JS/TS config files common, and what are the practical tradeoffs?
- What is the documented precedence between flags, env vars, project config, user config, and defaults?
- Are config values namespaced by command, top-level product settings, or both?
- Does the tool offer commands that mutate config (`config set`, `config get`, `login`, `use`, `switch`, etc.)?
- Where do users commonly get confused? Use issues, docs warnings, migration guides, or support threads as evidence.

## Specific design questions

### A. Core API shape

Compare at least these candidate APIs:

```ts
defineCli({
  name: "acme",
  config: {
    files: ["acme.json", "acme.yaml"],
    schema: z.object({
      baseUrl: z.string().url().default("https://api.acme.dev"),
      timeoutMs: z.number().default(30000),
    }),
  },
  commands: [],
})
```

```ts
defineCli({
  name: "acme",
  config: Config.object({
    files: ["acme.json", "acme.yaml"],
    schema: z.object({
      baseUrl: z.string().url().default("https://api.acme.dev"),
      timeoutMs: z.number().default(30000),
    }),
  }),
  commands: [],
})
```

```ts
defineCli({
  name: "acme",
  config: Config.object({
    files: ["acme.json", "acme.yaml"],
    schema: z.object({
      baseUrl: z.string().url().default("https://api.acme.dev"),
      timeoutMs: z.number().default(30000),
    }),
  }),
  commands: [],
})
```

Questions:

1. Is a `Config` static-class API consistent with how successful CLI frameworks expose first-class concepts, or is a plain object better?
2. Should config schema be Zod in core, or should config use the same `Schema` abstraction as command args/options/env?
3. Should handlers receive `ctx.config`, or should config only feed command options?
4. Should core expose value provenance, such as `ctx.sources.config.baseUrl === "project-file"`?
5. Should `config` have a typed default path policy, or should `files` be explicit only?
6. Should config support layered scopes in MVP, or only one resolved config object?
7. Should config support read-only resolution first, with config mutation commands deferred?

### B. Runtime model

Research and recommend:

1. Whether the core primitive should support multiple layers:

```txt
argv > env-backed option defaults > project config > user config > global config > schema defaults
```

2. Whether different config keys should opt into different scopes.
3. Whether command-specific option config should live under `commands.<path>.options`, top-level keys, or both.
4. Whether a config file should be allowed to set global output preferences such as `format`, `json`, `color`, telemetry, update channel, and default profile.
5. Whether core should parse TOML in addition to JSON/YAML, given common CLI precedent.
6. Whether JS/TS config files should be supported by core, by product/build only, or not at all.
7. Whether config should be loaded before command resolution, after command resolution, or in two phases.
8. How to handle unknown keys: reject, warn, ignore, or allow extension namespaces.
9. How to handle partial invalid config when the selected command only needs a subset.

### C. Product abstraction

Research and recommend the higher-level `@lili/product` API.

Candidate:

```ts
defineProduct({
  id: "workers",
  name: "Workers",
  version: "1.0.0",
  config: Config.object({
    files: ["workers.json", "workers.yaml", "wrangler.jsonc"],
    fields: Shape.object({
      accountId: Field.string("Default account ID").optional(),
      apiBaseUrl: Field.url("API base URL").default("https://api.cloudflare.com/client/v4"),
    }),
  }),
  bindings: {
    kv_namespaces: {
      doc: "KV namespaces bound to the Worker.",
      fields: Shape.object({
        binding: Field.string("Variable name in code"),
        id: Field.string("KV namespace ID"),
      }),
    },
  },
})
```

Questions:

1. Should Product expose `.config(...)`, `.binding(...)`, or both?
2. Are bindings just a namespaced config collection, or do they deserve a separate concept because they project to product-specific surfaces?
3. Should product config fields participate in generated CLI help, docs, MCP/agent references, release manifests, and config JSON Schema?
4. Should product config fields be allowed to satisfy command options automatically, or should commands explicitly bind to config fields?
5. How should Product prevent secrets from accidentally entering config schema, docs, release manifests, and agent surfaces?
6. Should generated CLIs include `config get/set/list/path/doctor` commands by default, opt in to them, or never generate them in MVP?

### D. Security and state boundary

Research how popular CLIs separate:

- durable config
- credentials
- session state
- selected profile/context
- cache
- machine-local runtime data

Compare at least Git, npm, AWS CLI, kubectl, gh, Docker, Terraform, and Wrangler.

Answer:

1. Which values should never live in config by default?
2. Which values commonly do live in config despite being sensitive?
3. What security warnings or migration stories exist around plaintext config?
4. Are users better served by a strict separation, or by a policy-based system with explicit plaintext/env/secure-store modes?
5. What should `lili` document as the default without blocking legitimate plaintext/env-only workflows?

### E. CLI UX

Research common UX patterns for config:

1. `tool config get/set/list/unset`.
2. `tool config path`.
3. `tool config edit`.
4. `tool doctor` reporting config source and invalid values.
5. `--show-config`, `--print-config`, or `--inspect-config`.
6. `--config <path>` and `--no-config`.
7. `--cwd`, `--project`, `--workspace`, or equivalent for config root selection.
8. Explicit `--profile` versus config-stored defaults.

Recommend which of these belong in `@lili/core` as reusable generated/helper behavior, which belong in `@lili/product`, and which should be application-owned.

## Evidence requirements

- Every claim about what another tool does must cite official documentation, source code, a canonical repository file, or a real issue/discussion.
- Prefer stable URLs to documentation pages or tagged source files. Avoid transient agent citations.
- Distinguish "framework provides this" from "many applications implement this themselves."
- Distinguish current behavior from historical behavior, especially for tools that changed config systems recently.
- If a source is old or ambiguous, label the finding as stale or unresolved.
- Include examples of actual config files and command invocations where possible.

## Deliverable shape

The ideal output is one document, 3000-6000 words, containing:

1. **Direct recommendation** for the core config primitive, with a short rationale.
2. **Direct recommendation** for the Product abstraction over core config.
3. **Competitive landscape table** for framework-level APIs.
4. **Competitive landscape table** for product CLIs.
5. **Precedence matrix** showing how leading tools order flags, env, project config, user config, global config, and defaults.
6. **File-discovery matrix** showing explicit flags, auto-discovered names, search roots, and escape hatches.
7. **State-boundary summary** for config vs secrets vs sessions vs cache.
8. **API sketch** for `@lili/core` and `@lili/product`, including at least one handwritten CLI example and one Product-generated CLI example.
9. **Testable behavior contract**: 8-15 requirements we can convert into docs and tests.
10. **Open questions** the research could not resolve.

## Success criteria

The research is successful if it lets us make a hard design call on:

- whether `Config` is public `@lili/core` API
- whether `Config` is also re-exported or mirrored by `@lili/product`
- whether config can feed `ctx.config`, command options, or both
- which file formats and search scopes are MVP
- whether config mutation commands are MVP or deferred
- how Product bindings relate to general config fields
- how to keep credentials/session state out of config without making legitimate plaintext or env-only workflows impossible

The final recommendation should be specific enough to update `docs/core-api-boundary.md`, `docs/product-schema.md`, `docs/auth-session.md`, `docs/env-vars.md`, and `docs/coverage-rewrite.md` without another round of abstract debate.
