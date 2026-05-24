# Product Workers example

This is the smallest useful generated-product example. It defines one resource, one hybrid workflow command, one local command, one general config object, one platform binding, and opt-in local ops.

Generate surfaces in place:

```sh
liche-product generate examples/product-workers/product.ts --out examples/product-workers
```

Check generated surfaces:

```sh
liche-product generate examples/product-workers/product.ts --out examples/product-workers --check --json
```

Run the generated CLI:

```sh
bun examples/product-workers/run-generated.ts deploy --entrypoint src/index.ts --environment preview --json
bun examples/product-workers/run-generated.ts dev --entrypoint src/index.ts --json
bun examples/product-workers/run-generated.ts script list --json
bun examples/product-workers/run-generated.ts doctor --json
bun examples/product-workers/run-generated.ts release --json
bun examples/product-workers/run-generated.ts telemetry --json
```

`script list` is remote HTTP-backed when a generated config file supplies `apiBaseUrl`; without a file it falls back to the declared schema default.

`doctor --json` emits one structured supportability report for local install health plus generated Product posture: config fields, remote base URL source, auth posture, static notices, static release metadata, and agent-visible command annotation quality. `release --json` prints the embedded install/update/channel/yank metadata without calling a hosted update service.
