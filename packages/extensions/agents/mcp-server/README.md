# @liche/mcp-server

MCP (Model Context Protocol) server runtime extension for `@liche/core` CLIs.

Adds a `--mcp` global flag that turns the CLI into a JSON-RPC MCP server over stdio, and a `/mcp` HTTP route that handles MCP requests over HTTP. Commands become MCP tools according to this adapter's policy: interactive commands are hidden by default, and callers can pass `tools.include` / `tools.exclude` for explicit visibility.

```ts
import { arg, defineCli, defineCommand, z } from '@liche/core'
import { mcpServer } from '@liche/mcp-server'

defineCli({
  name: 'shipyard',
  extensions: [mcpServer({ tools: { include: ['deploy', 'status'] } })],
  commands: [
    defineCommand({
      path: ['deploy'],
      input: {
        options: z.object({
          replicas: arg.positiveInt().default(1),
        }),
      },
      run: ({ options }) => ({ replicas: options.replicas }),
    }),
  ],
})
```

## Tool projection

The adapter projects Core command contracts to MCP tools without executing handlers. Runtime validation still flows through Core, so command failures are returned as `result.isError: true` with the command error envelope serialized in `content[0].text`.

Validation errors preserve their MCP input source:

```json
{
  "fieldErrors": [
    {
      "path": "$.replicas",
      "source": { "kind": "extension", "transport": "mcp", "key": "replicas" }
    }
  ]
}
```

`arg.fromString()` surface policy is enforced before calls run. A CLI-only codec is excluded from `tools/list`, and `tools/call` returns JSON-RPC `-32602` with `data.code: "UNSUPPORTED_SURFACE"` if a caller attempts to invoke it anyway. Codecs marked `surface: "all"` or `surface: { kind: "extension", transport: "mcp" }` are visible to this adapter.

Pair with `@liche/mcp-installer` to register the binary as an MCP server in Claude Code / Cursor config.
