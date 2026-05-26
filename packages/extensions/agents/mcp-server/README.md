# @liche/mcp-server

MCP (Model Context Protocol) server runtime extension for `@liche/core` CLIs.

Adds a `--mcp` global flag that turns the CLI into a JSON-RPC MCP server over stdio, and a `/mcp` HTTP route that handles MCP requests over HTTP. Commands become MCP tools according to this adapter's policy: interactive commands are hidden by default, and callers can pass `tools.include` / `tools.exclude` for explicit visibility.

```ts
import { defineCli } from '@liche/core'
import { mcpServer } from '@liche/mcp-server'

defineCli({
  name: 'shipyard',
  extensions: [mcpServer({ tools: { include: ['deploy', 'status'] } })],
})
```

Pair with `@liche/mcp-installer` to register the binary as an MCP server in Claude Code / Cursor config.
