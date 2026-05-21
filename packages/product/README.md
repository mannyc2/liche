# @lili/product

Product schema authoring, generated surfaces, and conformance for Lili CLIs.

Use `@lili/product` when one product catalog should drive CLI source, OpenAPI, command manifests, MCP tools, agent docs, user docs, config schema, catalog/discovery artifacts, compile entrypoints, auth/session commands, local diagnostics, telemetry status, and conformance checks.

```ts
import { Auth, Command, Field, Product, Runtime, Shape } from "@lili/product";

export default Product.create({ id: "workers", name: "Workers", version: "1.0.0" })
  .auth(Auth.none())
  .remote({ baseUrl: Runtime.env("WORKERS_API_BASE_URL") })
  .command("deploy", Command.remoteHttp({
    summary: "Deploy a Worker",
    input: Shape.object({ name: Field.string("Worker name") }),
    output: Shape.object({ id: Field.string("Deployment ID") }),
    http: { method: "POST", path: "/deployments", bind: { body: true } },
  }));
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

## Conformance

Run conformance against an owned fixture server or local server:

```sh
li-product conform ./product.ts --base-url http://localhost:8787 --report .lili/conformance.json --json
```

Conformance reports redact auth material and keep destructive capabilities opt-in.

Generated CLIs use `@lili/core` for runtime behavior, config, auth/session state, local diagnostics, telemetry sinks, and HTTP transport.
