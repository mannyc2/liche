# Product auth/session example

This product demonstrates generated OAuth device login, file-backed sessions, profiles, context selection, and auth status commands.

Generate surfaces in place:

```sh
liche-product generate examples/product-auth-session/product.ts --out examples/product-auth-session
```

Run the generated auth commands:

```sh
bun examples/product-auth-session/run-generated.ts login --json
bun examples/product-auth-session/run-generated.ts switch --org acme --json
bun examples/product-auth-session/run-generated.ts whoami --json
bun examples/product-auth-session/run-generated.ts logout --json
```

The smoke test uses a fake OAuth device server and a temp `LICHE_HOME` so no real credentials are stored.
