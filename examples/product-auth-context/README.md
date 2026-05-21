# Product auth/context example

This product demonstrates generated auth metadata and runtime credential/context resolution.

Generate surfaces in place:

```sh
bun packages/product/src/cli.ts generate examples/product-auth-context/product.ts --out examples/product-auth-context
```

Run the generated CLI without credentials:

```sh
bun examples/product-auth-context/run-generated.ts purge --zone zone-a --org acme --json
```

Run with a local token:

```sh
ACME_TOKEN=tok_example bun examples/product-auth-context/run-generated.ts purge --zone zone-a --org acme --json
```

Run with CI-only token and env context:

```sh
CI=true ACME_CI_TOKEN=tok_ci ACME_ORG_ID=acme bun examples/product-auth-context/run-generated.ts purge --zone zone-a --json
```

The final command currently returns `REMOTE_NOT_IMPLEMENTED` after auth/context resolution succeeds. That is expected until remote transport lands.
