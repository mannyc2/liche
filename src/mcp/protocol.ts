import type { CliState, Dict, Result } from '../types.js'
import { collectCommands, mcpToolName, selectCommand } from '../command/registry.js'
import { execute } from '../cli/execute.js'

export async function mcpMessage(binaryName: string, state: CliState, message: any) {
  const id = message?.id

  if (message?.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        capabilities: { tools: {} },
        protocolVersion: '2025-06-18',
        serverInfo: { name: binaryName, version: state.def.version ?? '0.0.0' },
      },
    }
  }

  if (message?.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: collectCommands(state.commands, state.root).map((command: any) => ({
          description: command.description,
          inputSchema: { properties: { args: command.schema?.args, options: command.schema?.options }, type: 'object' },
          name: mcpToolName(command.name),
        })),
      },
    }
  }

  if (message?.method === 'tools/call') {
    const { name: toolName, arguments: input = {} } = message.params ?? {}
    const canonical = collectCommands(state.commands, state.root).find((entry: any) => mcpToolName(entry.name) === toolName)?.name
    const path = !canonical || canonical === '(root)' ? [] : canonical.split(' ')
    const selected = canonical ? selectCommand(state, path) : undefined
    const selectedToolName = selected?.path.length ? mcpToolName(selected.path.join(' ')) : '(root)'
    const result: Result = selected && selectedToolName === toolName
      ? await execute(binaryName, selected, {
          agent: true,
          argvOptions: { args: [], argsObject: input.args ?? {}, options: input.options ?? {} },
          displayName: binaryName,
          env: Bun.env as Dict<string | undefined>,
          format: 'json',
          formatExplicit: true,
          middlewares: state.middlewares.concat(selected.middlewares),
        })
      : { ok: false, error: { code: 'COMMAND_NOT_FOUND', message: `No tool ${toolName}` } }

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ text: JSON.stringify(result.ok ? result.data : result.error), type: 'text' }],
        isError: !result.ok,
      },
    }
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }
}
