# Core handwritten CLI example

This example uses `@liche/core` directly. There is no product schema or generated catalog.

Run commands:

```sh
bun examples/core-handwritten/cli.ts summarize README.md --style brief --json
bun examples/core-handwritten/cli.ts echo hello --shout --json
bun examples/core-handwritten/cli.ts completions bash
```

The example also exercises newer Core primitives:

- argv flag, positional arg, env, and global parsing all use the same validation pipeline
- validation errors preserve the source that supplied the bad value
- middleware writes `ctx.var.requestId`, and the handler reads it through the typed run context
- command contracts, help, completions, and reflection all come from the same command graph

Source-aware failures are easiest to see with an invalid enum value:

```sh
bun examples/core-handwritten/cli.ts summarize README.md --style verbose
```

The human renderer points at `--style`; JSON output includes the structured `fieldErrors[].source` payload.

`mcp` and `skills` remain disabled in this example.
