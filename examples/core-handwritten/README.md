# Core handwritten CLI example

This example uses `@liche/core` directly. There is no product schema or generated catalog.

Run commands:

```sh
bun examples/core-handwritten/cli.ts summarize README.md --style brief --json
bun examples/core-handwritten/cli.ts echo hello --shout --json
bun examples/core-handwritten/cli.ts completions bash
```

`mcp` and `skills` remain disabled in this example.
