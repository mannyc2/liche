# @lili/product

Product schema authoring, generated surfaces, and conformance for Lili CLIs.

This package is published as Bun-only TypeScript source. Use Bun `>= 1.3.0`; v1 does not ship `dist` or declaration artifacts.

Use `@lili/product` when one product catalog should drive CLI source, OpenAPI, command manifests, MCP tools, agent docs, user docs, config schema, catalog/discovery artifacts, compile entrypoints, auth/session commands, local diagnostics, telemetry status, and conformance checks.

```ts
import { Auth, Command, Field, Runtime, Shape, defineProduct } from "@lili/product";

export default defineProduct({
  id: "workers",
  name: "Workers",
  version: "1.0.0",
  auth: Auth.none(),
  remote: { baseUrl: Runtime.env("WORKERS_API_BASE_URL") },
  commands: {
    deploy: Command.remoteHttp({
      summary: "Deploy a Worker",
      input: Shape.object({ name: Field.string("Worker name") }),
      output: Shape.object({ id: Field.string("Deployment ID") }),
      http: { method: "POST", path: "/deployments", bind: { body: true } },
    }),
  },
});
```

## Generate

```sh
li-product generate ./product.ts --out ./generated
li-product generate ./product.ts --out ./generated --check --json
```

Generated artifacts include:

- `lili.generated.ts`
- `lili.generated.openapi.json`
- `lili.generated.commands.json`
- `lili.generated.mcp.json`
- `lili.generated.agent.md`
- `lili.generated.docs.md`
- `lili.generated.config.schema.json`
- `lili.generated.catalog.json`
- `lili.generated.discovery.json`
- `lili.compile-entry.ts`
- `lili.generated.manifest.json`

Opt-in `ops.release` metadata is embedded into generated docs, discovery JSON, `doctor --json`, and a local `release --json` command. It is static by design: install commands, channel, latest known version, packages, and yanked versions are available to users and agents without a hosted update service.

## Conformance

Run conformance against an owned fixture server or local server:

```sh
li-product conform ./product.ts --base-url http://localhost:8787 --report .lili/conformance.json --json
```

Conformance reports redact auth material and keep destructive capabilities opt-in.

Generated CLIs use `@lili/core` for runtime behavior, config, auth/session state, config-owned diagnostics, opt-in telemetry sinks, and HTTP transport. Catalog-generated surfaces remain canonical for Product command manifests, MCP tools, agent docs, and reference docs.
