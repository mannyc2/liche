import type { CliEvent, CliEventError, CliEventSubscription, CliState, CommandError, Dict, FieldErrorSource, Result } from '@liche/core'
import {
  checkCommandSurface,
  collectCommandContracts,
  createLifecycleEvent,
  emitLifecycleEvent,
  eventCommand,
  execute,
  mcpToolName,
  mergeHooks,
  nonInteractiveStdio,
  selectCommand,
  streamKinds,
} from '@liche/core'
import { jsonSchema, mcpAnnotations, objectSchema } from './annotations.js'
import { isRecord, jsonRpcError, validateJsonRpc } from './json-rpc.js'

const MCP_SURFACE = { kind: 'extension', transport: 'mcp' } as const

// MCP is never a terminal: fixed non-interactive stdio for events/execute.
const MCP_STDIO = nonInteractiveStdio()
const MCP_STREAMS = streamKinds(MCP_STDIO)

export const MCP_PROTOCOL_VERSION = '2025-11-25'

export type McpToolPolicy = {
  include?: readonly string[] | undefined
  exclude?: readonly string[] | undefined
}

export async function mcpMessage(binaryName: string, state: CliState, message: any, policy: McpToolPolicy = {}) {
  const protocol = validateJsonRpc(message)
  if (!protocol.ok) return protocol.response
  if (protocol.notification) return undefined
  const id = protocol.id

  if (message?.method === 'initialize') {
    await emitMcpLifecycle(binaryName, state, state.events, {
      streams: MCP_STREAMS,
      format: 'json',
      formatExplicit: true,
      attributes: { mcpMethod: 'initialize' },
      surface: { kind: 'command' },
      type: 'mcp.initialize',
    })
    return {
      jsonrpc: '2.0',
      id,
      result: {
        capabilities: { tools: {} },
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: { name: binaryName, version: state.def.version ?? '0.0.0' },
      },
    }
  }

  if (message?.method === 'tools/list') {
    const tools = mcpCommandContracts(state, policy)
      .filter((command: any) => {
        const entry = selectCommand(state, commandNameToPath(command.name))?.entry
        return checkCommandSurface(entry, MCP_SURFACE).ok
      })
      .map((command: any) => ({
        description: command.description,
        inputSchema: {
          additionalProperties: false,
          properties: {
            args: objectSchema(command.schema?.args),
            options: objectSchema(command.schema?.options),
          },
          type: 'object',
        },
        name: mcpToolName(command.name),
        ...(jsonSchema(command.schema?.output) ? { outputSchema: jsonSchema(command.schema?.output) } : undefined),
        annotations: mcpAnnotations(command),
      }))
    await emitMcpLifecycle(binaryName, state, state.events, {
      streams: MCP_STREAMS,
      format: 'json',
      formatExplicit: true,
      attributes: { mcpMethod: 'tools/list', mcpToolCount: tools.length },
      surface: { kind: 'command' },
      type: 'mcp.tools_listed',
    })
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools,
      },
    }
  }

  if (message?.method === 'tools/call') {
    if (!isRecord(message.params) || typeof message.params.name !== 'string') {
      return jsonRpcError(id, -32600, 'Invalid Request')
    }
    if (message.params.arguments !== undefined && !isRecord(message.params.arguments)) {
      return jsonRpcError(id, -32600, 'Invalid Request')
    }
    const { name: toolName, arguments: input = {} } = message.params
    const canonical = mcpCommandContracts(state, policy).find((entry: any) => mcpToolName(entry.name) === toolName)?.name
    const path = canonical ? commandNameToPath(canonical) : []
    const selected = canonical ? selectCommand(state, path) : undefined
    const selectedToolName = selected?.path.length ? mcpToolName(selected.path.join(' ')) : '(root)'
    const subscriptions = selected ? state.events.concat(selected.events) : state.events
    const command = selected && selectedToolName === toolName ? eventCommand(selected) : undefined
    const surfaceCheck = selected ? checkCommandSurface(selected.entry, MCP_SURFACE) : { ok: true as const }
    if (selected && !surfaceCheck.ok) {
      await emitMcpLifecycle(binaryName, state, subscriptions, {
        streams: MCP_STREAMS,
        ...(command ? { command } : undefined),
        durationMs: 0,
        error: {
          code: 'UNSUPPORTED_SURFACE',
          codecKind: surfaceCheck.codecKind,
          field: surfaceCheck.field,
        } as unknown as CliEventError,
        exitCode: 1,
        result: 'user_error',
        format: 'json',
        formatExplicit: true,
        attributes: { mcpMethod: 'tools/call' },
        surface: { kind: 'command' },
        type: 'mcp.tool_call.failed',
      })
      return jsonRpcError(id, -32602, 'Unsupported surface', {
        code: 'UNSUPPORTED_SURFACE',
        codecKind: surfaceCheck.codecKind,
        field: surfaceCheck.field,
        surface: surfaceCheck.surface,
      })
    }
    const startedAt = Date.now()
    if (command) {
      await emitMcpLifecycle(binaryName, state, subscriptions, {
        streams: MCP_STREAMS,
        command,
        format: 'json',
        formatExplicit: true,
        attributes: { mcpMethod: 'tools/call' },
        surface: { kind: 'command' },
        type: 'mcp.tool_call.started',
      })
    }
    const argHints: Record<string, FieldErrorSource> = {}
    for (const key of Object.keys((input as any).args ?? {})) {
      argHints[key] = { kind: 'extension', transport: 'mcp', key }
    }
    const optionHints: Record<string, FieldErrorSource> = {}
    for (const key of Object.keys((input as any).options ?? {})) {
      optionHints[key] = { kind: 'extension', transport: 'mcp', key }
    }
    const result: Result = selected && command
      ? await execute(binaryName, selected, {
          argvOptions: { args: [], argsObject: input.args ?? {}, options: input.options ?? {} },
          displayName: binaryName,
          events: subscriptions,
          env: { ...(Bun.env as Dict<string | undefined>), LICHE_INVOCATION: 'mcp' } as Dict<string | undefined>,
          format: 'json',
          formatExplicit: true,
          global: {},
          hooks: mergeHooks(state.hooks, selected.hooks),
          inputSourceHints: { args: argHints, options: optionHints },
          stdio: MCP_STDIO,
          middlewares: state.middlewares.concat(selected.middlewares),
          version: state.def.version,
        })
      : { ok: false, data: null, error: { code: 'COMMAND_NOT_FOUND', message: `No tool ${toolName}` } }

    await emitMcpLifecycle(binaryName, state, subscriptions, {
      streams: MCP_STREAMS,
      ...(command ? { command } : undefined),
      durationMs: Date.now() - startedAt,
      ...(result.ok ? { exitCode: 0, result: 'success' as const } : {
        error: mcpEventError(result.error),
        exitCode: Number(result.error.exitCode ?? 1),
        result: 'user_error' as const,
      }),
      format: 'json',
      formatExplicit: true,
      attributes: { mcpMethod: 'tools/call' },
      surface: { kind: 'command' },
      type: result.ok ? 'mcp.tool_call.completed' : 'mcp.tool_call.failed',
    })

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

function mcpCommandContracts(state: CliState, policy: McpToolPolicy) {
  return collectCommandContracts(state.commands, state.root).filter((command) => isToolVisible(command, policy))
}

function commandNameToPath(name: string): string[] {
  return !name || name === '(root)' ? [] : name.split(' ')
}

function isToolVisible(command: { interactive?: boolean | undefined; name: string }, policy: McpToolPolicy): boolean {
  if (command.interactive) return false
  const path = command.name
  const tool = mcpToolName(command.name)
  if (policy.include && !policy.include.some((value) => value === path || value === tool)) return false
  if (policy.exclude?.some((value) => value === path || value === tool)) return false
  return true
}

async function emitMcpLifecycle(
  binaryName: string,
  state: CliState,
  subscriptions: readonly CliEventSubscription[],
  event: Omit<CliEvent, 'cli' | 'occurredAt'>,
): Promise<void> {
  await emitLifecycleEvent(subscriptions, createLifecycleEvent(binaryName, state.def.version, event))
}

function mcpEventError(error: CommandError): CliEventError {
  return {
    code: error.code,
    ...(error.exitCode !== undefined ? { exitCode: Number(error.exitCode) } : undefined),
    ...(error.fieldErrors !== undefined ? { fieldErrorCount: error.fieldErrors.length } : undefined),
    ...(error.retryable !== undefined ? { retryable: error.retryable } : undefined),
    ...(error.status !== undefined ? { status: error.status } : undefined),
  }
}
