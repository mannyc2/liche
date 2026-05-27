import { defineExtension } from '@liche/core'
import type { CliExtension } from '@liche/core'
import { handleMcpHttp } from './http.js'
import type { McpToolPolicy } from './protocol.js'
import { serveMcp } from './stdio.js'

export type McpServerOptions = {
  /** URL pathname that handles MCP HTTP requests. Defaults to `/mcp`. */
  httpPath?: string | undefined
  tools?: McpToolPolicy | undefined
}

export function mcpServer(options: McpServerOptions = {}): CliExtension {
  const httpPath = options.httpPath ?? '/mcp'
  const toolPolicy = options.tools ?? {}
  return defineExtension({
    id: 'liche.mcp-server',
    globals: [{ expose: 'runtime', flag: 'mcp', key: 'mcp', type: 'boolean' }],
    terminalHandlers: [
      {
        flagKey: 'mcp',
        handle: ({ binaryName, options, state }) => serveMcp(binaryName, state, options, toolPolicy),
      },
    ],
    fetchRoutes: [
      {
        match: (url) => url.pathname === httpPath,
        handle: ({ binaryName, request, state }) => handleMcpHttp(binaryName, state, request, toolPolicy),
      },
    ],
  })
}

export { mcpMessage, MCP_PROTOCOL_VERSION } from './protocol.js'
export type { McpToolPolicy } from './protocol.js'
export { serveMcp } from './stdio.js'
export { handleMcpHttp } from './http.js'
