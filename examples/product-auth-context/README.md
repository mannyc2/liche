# Product auth/context example

This product demonstrates generated auth metadata and runtime credential/context resolution.

Generate surfaces in place:

```sh
li-product generate examples/product-auth-context/product.ts --out examples/product-auth-context
```

Run the generated CLI without credentials:

```sh
bun examples/product-auth-context/run-generated.ts purge --zone zone-a --org acme --json
```

Run with a local token:

```sh
ACME_API_BASE_URL=https://api.acme.example.test ACME_TOKEN=tok_example bun examples/product-auth-context/run-generated.ts purge --zone zone-a --org acme --json
```

Run with CI-only token and env context:

```sh
CI=true ACME_API_BASE_URL=https://api.acme.example.test ACME_CI_TOKEN=tok_ci ACME_ORG_ID=acme bun examples/product-auth-context/run-generated.ts purge --zone zone-a --json
```

The command resolves auth and org context before calling the HTTP transport. `ACME_API_BASE_URL` is required because generated remote commands no longer emit placeholder transport stubs.
