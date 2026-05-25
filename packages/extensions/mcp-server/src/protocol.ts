import type { CliEvent, CliEventError, CliEventSubscription, CliState, CommandError, Dict, Result } from '@liche/core'
import {
  collectCommandContracts,
  createLifecycleEvent,
  emitLifecycleEvent,
  eventCommand,
  execute,
  mcpToolName,
  mergeHooks,
  selectCommand,
} from '@liche/core'
import { jsonSchema, mcpAnnotations, objectSchema } from './annotations.js'
import { isRecord, jsonRpcError, validateJsonRpc } from './json-rpc.js'

export const MCP_PROTOCOL_VERSION = '2025-11-25'

export async function mcpMessage(binaryName: string, state: CliState, message: any) {
  const protocol = validateJsonRpc(message)
  if (!protocol.ok) return protocol.response
  if (protocol.notification) return undefined
  const id = protocol.id

  if (message?.method === 'initialize') {
    await emitMcpLifecycle(binaryName, state, state.events, {
      agent: true,
      format: 'json',
      formatExplicit: true,
      invocation: 'mcp',
      mcp: { method: 'initialize' },
      surface: { kind: 'mcp' },
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
    const tools = mcpCommandContracts(state).map((command: any) => ({
      ...(command.auth ? { auth: command.auth } : undefined),
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
      agent: true,
      format: 'json',
      formatExplicit: true,
      invocation: 'mcp',
      mcp: { method: 'tools/list', toolCount: tools.length },
      surface: { kind: 'mcp' },
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
    const canonical = mcpCommandContracts(state).find((entry: any) => mcpToolName(entry.name) === toolName)?.name
    const path = !canonical || canonical === '(root)' ? [] : canonical.split(' ')
    const selected = canonical ? selectCommand(state, path) : undefined
    const selectedToolName = selected?.path.length ? mcpToolName(selected.path.join(' ')) : '(root)'
    const subscriptions = selected ? state.events.concat(selected.events) : state.events
    const command = selected && selectedToolName === toolName ? eventCommand(selected) : undefined
    const startedAt = Date.now()
    if (command) {
      await emitMcpLifecycle(binaryName, state, subscriptions, {
        agent: true,
        command,
        format: 'json',
        formatExplicit: true,
        invocation: 'mcp',
        mcp: { method: 'tools/call' },
        surface: { kind: 'mcp' },
        type: 'mcp.tool_call.started',
      })
    }
    const result: Result = selected && command
      ? await execute(binaryName, selected, {
          agent: true,
          argvOptions: { args: [], argsObject: input.args ?? {}, options: input.options ?? {} },
          displayName: binaryName,
          events: subscriptions,
          env: Bun.env as Dict<string | undefined>,
          format: 'json',
          formatExplicit: true,
          global: {},
          hooks: mergeHooks(state.hooks, selected.hooks),
          invocation: 'mcp',
          isTty: false,
          middlewares: state.middlewares.concat(selected.middlewares),
          version: state.def.version,
        })
      : { ok: false, data: null, error: { code: 'COMMAND_NOT_FOUND', message: `No tool ${toolName}` } }

    await emitMcpLifecycle(binaryName, state, subscriptions, {
      agent: true,
      ...(command ? { command } : undefined),
      durationMs: Date.now() - startedAt,
      ...(result.ok ? { exitCode: 0, result: 'success' as const } : {
        error: mcpEventError(result.error),
        exitCode: Number(result.error.exitCode ?? 1),
        result: 'user_error' as const,
      }),
      format: 'json',
      formatExplicit: true,
      invocation: 'mcp',
      mcp: { method: 'tools/call' },
      surface: { kind: 'mcp' },
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

function mcpCommandContracts(state: CliState) {
  return collectCommandContracts(state.commands, state.root).filter((command) => command.agent !== false)
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
