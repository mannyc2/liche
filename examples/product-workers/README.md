# Product Workers example

This is the smallest useful generated-product example. It defines one resource, one hybrid workflow command, one local command, one general config object, and one platform binding.

Generate surfaces in place:

```sh
bun packages/product/src/cli.ts generate examples/product-workers/product.ts --out examples/product-workers
```

Check generated surfaces:

```sh
bun packages/product/src/cli.ts generate examples/product-workers/product.ts --out examples/product-workers --check --json
```

Run the generated CLI:

```sh
bun examples/product-workers/run-generated.ts deploy --entrypoint src/index.ts --environment preview --json
bun examples/product-workers/run-generated.ts dev --entrypoint src/index.ts --json
bun examples/product-workers/run-generated.ts script list --json
```

`script list` is remote HTTP-backed when a generated config file supplies `apiBaseUrl`; without a file it falls back to the declared schema default.
