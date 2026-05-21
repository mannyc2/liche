# Core handwritten CLI example

This example uses `@lili/core` directly. There is no product schema or generated catalog.

Run commands:

```sh
bun examples/core-handwritten/cli.ts summarize README.md --style brief --json
bun examples/core-handwritten/cli.ts echo hello --shout --json
bun examples/core-handwritten/cli.ts completions bash
bun examples/core-handwritten/cli.ts gen --out examples/core-handwritten/lili.generated.ts --json
```

`gen` is enabled explicitly in this example. `mcp` and `skills` remain disabled.

