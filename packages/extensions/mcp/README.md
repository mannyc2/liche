# @liche/mcp

MCP server registration extension for `@liche/core` CLIs.

Adds an `mcp add` command that writes the MCP server config to the right file for the targeted agent. Built-in adapters cover `claude-code` (writes `~/.claude.json` global or `./.mcp.json` local) and `cursor` (writes `~/.cursor/mcp.json` or `./.cursor/mcp.json`). Unknown agents fall back to `~/.config/liche/mcp/<name>.json`.

```ts
import { defineCli } from '@liche/core'
import { mcpInstaller } from '@liche/mcp'

defineCli({
  name: 'shipyard',
  extensions: [mcpInstaller()],
})
```

`writeMcp(name, options)` is also exported for callers that want to perform the install programmatically without registering the command.
