# CLI config primitive

Config is an opt-in extension over Core's generic input-source primitive. Core owns command input assembly, ordered source resolution, validation timing, and option provenance; `@liche/config` owns config files, discovery, file formats, `--config`, `--no-config`, and config-specific diagnostics.

## What this gives you

- Handwritten CLIs can declare config through `@liche/config` without installing `@liche/product`.
- Generated Product CLIs lower product config declarations into the same core primitive as handwritten CLIs.
- General config and product bindings stay separate authoring concepts.
- Auth/session/profile state stays outside general config.
- Remote Product commands resolve base URLs and other durable non-secret defaults through declared sources. Generation fails when an HTTP-backed capability has no product remote base URL.
- JSON Schema/config surfaces include both general product config and bindings when Product declares either.

## Public API

Declare config through the official config extension:

```ts
import { defineCli, defineCommand, z } from "@liche/core";
import { config, files } from "@liche/config";

const cli = defineCli({
  name: "acme",
  extensions: [
    config({
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
      sources: [
        files({
          files: ["acme.json", "acme.jsonc", "acme.yaml", "acme.yml", "acme.toml"],
          scopes: {
            project: { discoverUpwards: true },
            user: { xdg: true },
          },
        }),
      ],
    }),
  ],
  commands: [
    defineCommand({
      path: ["deploy"],
      input: {
        options: z.object({
          org: z.string().optional(),
          timeoutMs: z.number().int().positive().default(30_000),
        }),
        sources: {
          options: {
            org: [{ provider: "config", path: "defaultOrg" }],
            timeoutMs: [{ provider: "config", path: "timeoutMs" }],
          },
        },
      },
      run({ ctx }) {
        ctx.sources.value("config", "baseUrl");
        ctx.sources.source("config", "baseUrl");
        ctx.sources.option("timeoutMs");
      },
    }),
  ],
});
```

`schema` is typed as core's public `Schema<T>` contract through the config extension. The example uses the public `z` authoring helper, but config does not require Zod; any `Schema<T>` works.

Handlers inspect config through the generic source inspector. The `input.sources.options` field declares explicit option-to-config bindings.

Config does not satisfy command options by automatic name matching. An option reads config only when the command explicitly binds that option to a config path.

## Runtime behavior

Resolution is two-phase:

1. Parse global config-control inputs: `--config <path>`, `--no-config`, and root-selection inputs such as `--cwd` if a generated CLI supports them.
2. Resolve the selected command, then resolve registered input-source providers and apply explicit source-to-option bindings before final option validation.

Behavior:

- A CLI without the config extension rejects `--config` and `--no-config` as unknown flags.
- `--config <path>` loads exactly that file and disables project/user discovery.
- `--no-config` disables project and user discovery.
- Passing `--config` and `--no-config` together is a parse error.
- Project config is discovered upward from the resolved working directory.
- User config uses XDG/AppData-style config roots.

Precedence:

```txt
argv
> declared input sources in order
> schema default
```

`session/profile runtime defaults` are not general config. They are a separate source that generated auth/session-aware CLIs may feed into command defaulting when the auth/session contract allows it.

Accepted file formats:

```txt
JSON
JSONC
YAML
TOML
```

JS/TS config files are not loaded. Executable config is a build-tool pattern; this primitive is for durable CLI preferences that must be portable, inspectable, schema-validatable, and safe to expose in generated docs when marked public.

Unknown keys fail by default through strict schema validation. Extension namespaces can be added later only with an explicit schema hook; unknown top-level keys are not silently ignored.

Read-only inspection helpers are available when a CLI opts in:

```txt
config path
config show --json
config doctor
```

Generic config mutation commands (`config set`, `config get`, `config list`, `config edit`) require scope selection, file preservation, comment survival, and secret handling rules. They are not available out of the box.

## Provenance

Provenance is exposed as APIs, not by mixing source wrappers into config values:

```ts
ctx.sources.source("config", "baseUrl");
// { kind: "project-file", path: "/repo/acme.toml" }

ctx.sources.option("timeoutMs");
// { kind: "argv" } | { kind: "provider", provider: "config", ... } | { kind: "default" }
```

Provenance feeds generated `doctor`, config inspection, tests, and debugging.

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

General config does not contain:

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

## Product API

Product exposes config and bindings as sibling fields on `defineProduct(...)`:

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

Bindings are not folded into generic config. A binding such as `kv_namespaces` may project to deployment config, reference docs, command manifests, or platform adapters. A general config field such as `apiBaseUrl` or `defaultOrg` is a durable CLI/product preference. They share generated schema and discovery machinery; they are not the same catalog node.

Product config fields lower into core config:

- generated CLI runtime config declaration
- config JSON Schema
- docs/reference markdown
- command manifest metadata where relevant
- agent/MCP references only when the field is public, non-secret, and operationally useful

Product config fields do not automatically enter release manifests. Release manifests may record non-secret runtime expectations, config file names, and config schema artifact digests; they do not record selected user values.

## Catalog model

Normalized config declarations sit alongside bindings in the catalog:

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

## Generated remote wiring

Product remote base URLs can point at literal values, env vars, or declared config fields. Generated remote commands resolve config before calling core HTTP transport. Auth/session resolution stays separate from config resolution.

- A generated remote command resolves `baseUrl` from config.
- Env-backed option defaults show as env sources, not config sources.
- Missing base URL reports structured remote config errors.
- Auth/session metadata and config provenance stay separate in `--json` output.

Generated commands report `meta.execution.source` from the declared base URL source: `schema-default` for literal/default values, `env` for env-backed values, and `config` when a config file or explicit config path supplies the winning value. Config-backed generated commands preflight an empty or non-string base URL with `REMOTE_CONFIG_MISSING_BASE_URL` before transport.

## Current limitations

- Per-field scope restrictions are not supported; project and user scopes apply globally.
- Generated config inspection helpers are explicit opt-ins; they are not enabled by default.
- A Product can disable user-scope config for repo-reproducible tools through config scope options.
- Generic config mutation commands (`set`, `get`, `list`, `edit`) are not provided.
