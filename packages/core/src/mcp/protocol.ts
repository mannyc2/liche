import type { CliEvent, CliEventError, CliEventSubscription, CliState, CommandError, Dict, Result } from '../types.js'
import { collectCommandContracts, mcpToolName, selectCommand } from '../command/registry.js'
import { execute } from '../cli/execute.js'
import { createLifecycleEvent, emitLifecycleEvent, eventCommand, mergeHooks } from '../cli/lifecycle.js'

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
    const tools = collectCommandContracts(state.commands, state.root).filter((command) => command.agent !== false).map((command: any) => ({
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
    const canonical = collectCommandContracts(state.commands, state.root).find((entry: any) => mcpToolName(entry.name) === toolName)?.name
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
      : { ok: false, error: { code: 'COMMAND_NOT_FOUND', message: `No tool ${toolName}` } }

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

export function mcpParseError() {
  return jsonRpcError(undefined, -32700, 'Parse error')
}

function validateJsonRpc(message: any):
  | { ok: true; id: string | number; notification: false }
  | { ok: true; notification: true }
  | { ok: false; response: ReturnType<typeof jsonRpcError> } {
  if (!isRecord(message)) return { ok: false, response: jsonRpcError(undefined, -32600, 'Invalid Request') }
  const id = validRequestId(message['id']) ? message['id'] : undefined

  if (message['jsonrpc'] !== '2.0') return { ok: false, response: jsonRpcError(id, -32600, 'Invalid Request') }
  if (typeof message['method'] !== 'string') return { ok: false, response: jsonRpcError(id, -32600, 'Invalid Request') }

  if (!Object.prototype.hasOwnProperty.call(message, 'id')) return { ok: true, notification: true }
  if (!validRequestId(message['id'])) return { ok: false, response: jsonRpcError(undefined, -32600, 'Invalid Request') }
  return { ok: true, id: message['id'], notification: false }
}

function validRequestId(value: unknown): value is string | number {
  return typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value))
}

function jsonRpcError(id: string | number | undefined, code: number, message: string) {
  return {
    jsonrpc: '2.0',
    ...(id === undefined ? undefined : { id }),
    error: { code, message },
  }
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

function objectSchema(value: unknown) {
  if (isRecord(value) && value['type'] === 'object') return value
  return { type: 'object', properties: {} }
}

function jsonSchema(value: unknown) {
  return isRecord(value) ? value : undefined
}

function mcpAnnotations(command: { effects?: any; examples?: unknown; name: string; policy?: any; safety?: any }): Record<string, unknown> {
  const destructive = command.safety?.destructive ?? (command.policy?.dangerous === true || command.effects?.kind === 'delete')
  const idempotent = command.safety?.idempotent ?? command.effects?.idempotent === true
  const openWorld = command.safety?.openWorld ?? true
  const readOnly = command.safety?.readOnly ?? command.effects?.kind === 'read'

  return {
    command: command.name,
    ...(command.effects ? { effects: command.effects } : undefined),
    ...(command.policy ? { policy: command.policy } : undefined),
    ...(command.safety ? { safety: command.safety } : undefined),
    ...(command.examples ? { examples: command.examples } : undefined),
    destructiveHint: destructive,
    idempotentHint: idempotent,
    openWorldHint: openWorld,
    readOnlyHint: readOnly,
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
