# CLI config primitive requirements

Config is an opt-in core CLI runtime primitive declared through the extension lane, not a product-only binding surface and not a loose application loader convention.

The current core runtime already accepts `--config`, `--no-config`, a low-level config hook, JSON/YAML file loading, and command-shaped option defaults. That is useful compatibility behavior, but it is not the target public model. The target model is a declared config contract that produces one typed `ctx.config`, explicit config-to-option bindings, and source provenance.

## Success criteria

- Handwritten CLIs can declare config through public `@liche/extensions/config` APIs without installing `@liche/product`.
- Generated Product CLIs lower product config declarations into the same core primitive as handwritten CLIs.
- General config and product bindings remain separate authoring concepts.
- Auth/session/profile state remains outside general config.
- Remote Product commands resolve base URLs and other durable non-secret defaults through declared sources; generation fails when an HTTP-backed capability has no product remote base URL.
- JSON Schema/config surfaces include both general product config and bindings when Product declares either.

## Public API target

Use the official config extension:

```ts
import { defineCli, defineCommand, z } from "@liche/core";
import { config } from "@liche/extensions/config";

const cli = defineCli({
  name: "acme",
  extensions: [
    config({
      files: ["acme.json", "acme.jsonc", "acme.yaml", "acme.yml", "acme.toml"],
      schema: z.object({
        baseUrl: z.string().url().default("https://api.acme.dev"),
        timeoutMs: z.number().int().positive().default(30_000),
        defaultOrg: z.string().optional(),
        output: z.object({
          format: z.enum(["text", "json"]).default("text"),
          color: z.enum(["auto", "always", "never"]).default("auto"),
        }),
        telemetry: z.object({
          enabled: z.boolean().default(false),
        }),
      }).strict(),
      scopes: {
        project: { discoverUpwards: true },
        user: { xdg: true },
      }),
    }),
  ],
  commands: [
    defineCommand({
      path: ["deploy"],
      input: {
        config: {
          org: "defaultOrg",
          timeoutMs: "timeoutMs",
        },
        options: z.object({
          org: z.string().optional(),
          timeoutMs: z.number().int().positive().default(30_000),
        }),
      },
      run({ ctx }) {
        ctx.config.baseUrl;
        ctx.sources.config("baseUrl");
        ctx.sources.option("timeoutMs");
      },
    }),
  ],
});
```

`schema` is typed as core's public `Schema<T>` contract through `CliExtension.config`. The example uses the current public `z` authoring helper, but config must not grow a config-only Zod coupling. If core later adds a value-level `Schema.object(...)` builder, `config(...)` should accept it through the same `Schema<T>` boundary.

Handlers receive `ctx.config` and source inspection separately:

The command example above uses `input.config` for explicit option-to-config bindings.

Config must not satisfy command options by automatic name matching. An option reads config only when the command explicitly binds that option to a config path.

## Runtime behavior

Resolution is two-phase:

1. Parse global config-control inputs: `--config <path>`, `--no-config`, and root-selection inputs such as `--cwd` if a generated CLI supports them.
2. Resolve the selected command, then discover, parse, merge, validate, and apply explicit config-to-option bindings before final option validation.

Required behavior:

- A CLI without a config declaration rejects `--config` and `--no-config` as parse errors.
- `--config <path>` loads exactly that file and disables project/user discovery.
- `--no-config` disables project and user discovery.
- Passing `--config` and `--no-config` together is a parse error.
- Project config is discovered upward from the resolved working directory.
- User config uses XDG/AppData-style config roots.
- Default precedence is:

```txt
argv
> optionEnv
> session/profile runtime defaults
> project config
> user config
> schema default
```

`session/profile runtime defaults` are not general config. They are a separate source that generated auth/session-aware CLIs may feed into command defaulting when the auth/session contract allows it.

Core MVP accepts data-only config files:

```txt
JSON
JSONC
YAML
TOML
```

Core does not load JS/TS config files. Executable config is a build-tool pattern; this primitive is for durable CLI preferences that must be portable, inspectable, schema-validatable, and safe to expose in generated docs when marked public.

Unknown keys fail by default through strict schema validation. Extension namespaces can be added later only with an explicit schema hook; do not silently ignore unknown top-level keys in MVP.

Generic config mutation commands are deferred. MVP may expose read-only inspection helpers when a CLI opts in:

```txt
config path
config show --json
config doctor
```

`config set`, `config get`, `config list`, and `config edit` require scope selection, file preservation, comment survival, and secret handling rules, so they are not core MVP defaults.

## Provenance

Expose provenance as APIs, not by mixing source wrappers into config values.

Target shape:

```ts
ctx.sources.config("baseUrl");
// { kind: "project-file", path: "/repo/acme.toml" }

ctx.sources.option("timeoutMs");
// "argv" | "env" | "session" | "project-config" | "user-config" | "default"
```

This provenance is required for generated `doctor`, config inspection, tests, and debugging. It also replaces the current source blind spot where config, env, and argv collapse into `ctx.options`.

## State boundary

General config may contain durable non-secret preferences:

```txt
baseUrl
timeoutMs
defaultOrg
defaultProject
defaultProfile
output format/color
telemetry posture
update channel
release renderer defaults
```

General config must not contain:

```txt
API tokens
refresh tokens
authorization headers
private keys
active login sessions
account identities
selected active runtime session blobs
cache entries
downloaded artifacts
last-run metadata
```

Secrets and stored sessions belong to auth/session primitives. Cache and machine-local data belong to cache/state paths. Context defaults such as `defaultOrg` can be config; active selected context stored with a profile remains auth/session state.

## Product API target

Product exposes config and bindings as sibling fields on `defineProduct(...)`.

```ts
import { Auth, Command, createConfig, Field, Runtime, Shape, defineProduct } from "@liche/product";

export default defineProduct({
  id: "workers",
  name: "Workers",
  version: "1.0.0",
  auth: Auth.none(),
  config: createConfig({
    files: ["workers.jsonc", "workers.yaml", "workers.toml"],
    fields: Shape.object({
      accountId: Field.string("Default account ID").optional(),
      apiBaseUrl: Field.url("API base URL").default("https://api.example.com"),
      outputFormat: Field.enum(["text", "json"]).default("text"),
    }),
  }),
  remote: {
    baseUrl: Runtime.config("apiBaseUrl"),
  },
  bindings: {
    kv_namespaces: {
      doc: "KV namespaces bound to the Worker.",
      fields: Shape.object({
        binding: Field.string("Variable name in code").required(),
        id: Field.string("KV namespace ID").required(),
      }),
    },
  },
  commands: {
    deploy: Command.remoteHttp({
      summary: "Deploy a Worker",
      http: { method: "POST", path: "/deployments" },
      input: Shape.object({
        accountId: Field.string("Account ID").fromConfig("accountId").required(),
      }),
    }),
  },
});
```

Bindings are not folded into generic config. A binding such as `kv_namespaces` may project to deployment config, reference docs, command manifests, or platform adapters. A general config field such as `apiBaseUrl` or `defaultOrg` is a durable CLI/product preference. They share generated schema and discovery machinery, but they are not the same catalog node.

Product config fields lower into core config:

- generated CLI runtime config declaration
- config JSON Schema
- docs/reference markdown
- command manifest metadata where relevant
- agent/MCP references only when the field is public, non-secret, and operationally useful

Product config fields do not automatically enter release manifests. Release manifests may record non-secret runtime expectations, config file names, and config schema artifact digests; they must not record selected user values.

## Catalog model additions

Add normalized config declarations as siblings of bindings:

```ts
type Catalog = {
  config?: NormalizedConfig | undefined;
  bindings: NormalizedBinding[];
  capabilities: Capability[];
};

type NormalizedConfig = {
  files: string[];
  scopes: {
    project: boolean;
    user: boolean;
  };
  fields: NormalizedObjectShape;
};
```

Config participates in the catalog digest because it changes generated runtime behavior and generated schema/docs surfaces. Runtime config values, discovered file paths, provenance, selected profile, selected contexts, and session state do not participate in the catalog digest.

## Implementation slices

### Slice A: core primitive and extension authoring

- Keep config resolution, provenance, and option binding in core.
- Add `config(...)` in `@liche/extensions/config` as the public authoring helper.
- Replace the low-level config hook shape with a typed declaration while preserving testable behavior through the extension API.
- Add `RunContext.config` and `RunContext.sources`.
- Add explicit option config bindings.
- Add JSONC and TOML parsing.
- Add project/user discovery and strict schema validation.

Verification:

- no-config CLIs reject `--config` and `--no-config`
- `--config` loads only the explicit file
- `--no-config` disables project/user discovery
- `--config` plus `--no-config` is invalid
- argv beats optionEnv, session defaults, project config, user config, and schema defaults
- config never satisfies unbound options by name
- unknown keys fail under strict schema
- source provenance reports the winning source

### Slice B: Product config catalog

- Add `createConfig` export in `@liche/product`.
- Add `defineProduct({ config })`.
- Normalize config separately from bindings.
- Generate config JSON Schema from general config and bindings.
- Add config field docs/reference output.
- Add lints that reject secret fields in general product config.

Verification:

- a product with config but no bindings emits a config schema
- a product with bindings but no general config keeps current binding schema behavior
- a product with both emits both top-level config fields and binding collections
- secret-marked fields fail in general config
- config fields affect catalog digest; runtime values do not

### Slice C: generated remote wiring

Status: implemented for generated Product remote base URL resolution.

- Add Product remote base URL sources that can point at literal values, env vars, or config fields.
- Generate remote commands that resolve config before calling core HTTP transport.
- Keep auth/session resolution separate from config resolution.

Verification:

- a generated remote command can resolve `baseUrl` from config
- env-backed option defaults still show as env sources, not config sources
- missing base URL reports structured remote config errors
- auth/session metadata and config provenance stay separate in `--json` output

Generated commands now report `meta.execution.source` from the declared base URL source: `schema-default` for literal/default values, `env` for env-backed values, and `config` when a config file or explicit config path supplies the winning value. Config-backed generated commands preflight an empty or non-string base URL with `REMOTE_CONFIG_MISSING_BASE_URL` before transport.

## Open questions

- Whether per-field scope restrictions are required in MVP. Default answer: no; support project and user scopes globally first.
- Whether generated config inspection helpers are enabled by default or explicit Product opt-ins. Default answer: explicit opt-in until UX is proven.
- Whether a Product can disable user-scope config for repo-reproducible tools. Default answer: yes, through config scope options.
