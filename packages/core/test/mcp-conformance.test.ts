import { describe, expect, test } from 'bun:test'
import {
  CallToolResultSchema,
  InitializeResultSchema,
  JSONRPCErrorResponseSchema,
  JSONRPCResultResponseSchema,
  LATEST_PROTOCOL_VERSION,
  ListToolsResultSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from '../src/index.js'
import * as Mcp from '../src/mcp/index.js'
import { stateOf, testCli, testCommand } from './helpers.js'

function request(id: string | number, method: string, params?: Record<string, unknown>) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? undefined : { params }) }
}

function expectSchema(schema: { safeParse: (value: unknown) => { success: boolean; error?: unknown } }, value: unknown) {
  const result = schema.safeParse(value)
  expect(result.success, result.success ? undefined : String(result.error)).toBe(true)
}

describe('MCP conformance against the official TypeScript SDK schemas', () => {
  test('initialize returns a JSON-RPC result with a current supported InitializeResult', async () => {
    const cli = testCli('app', { version: '1.2.3' }, [testCommand('run', { run: () => ({ ok: true }) })])
    const response: any = await Mcp.mcpMessage('app', stateOf(cli), request(1, 'initialize', {
      capabilities: {},
      clientInfo: { name: 'test-client', version: '0.0.0' },
      protocolVersion: LATEST_PROTOCOL_VERSION,
    }))

    expectSchema(JSONRPCResultResponseSchema, response)
    expectSchema(InitializeResultSchema, response.result)
    expect(response.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(response.result.protocolVersion)
  })

  test('tools/list returns an official ListToolsResult with JSON Schema object inputs', async () => {
    const cli = testCli('app', [testCommand('build', {
        args: z.object({ target: z.string() }),
        options: z.object({ dryRun: z.boolean().default(false) }),
        run: () => ({ ok: true }),
      })])
    const response: any = await Mcp.mcpMessage('app', stateOf(cli), request(2, 'tools/list'))

    expectSchema(JSONRPCResultResponseSchema, response)
    expectSchema(ListToolsResultSchema, response.result)
    expect(response.result.tools).toHaveLength(1)
    expect(response.result.tools[0]).toMatchObject({
      inputSchema: {
        type: 'object',
        properties: {
          args: { type: 'object' },
          options: { type: 'object' },
        },
      },
      name: 'build',
    })
  })

  test('tools/call returns an official CallToolResult for successful and command-error calls', async () => {
    const cli = testCli('app', [testCommand('ok', { run: () => ({ value: 1 }) }), testCommand('fail', { run: ({ error }) => error({ code: 'FAIL', message: 'nope' }) })])
    const state = stateOf(cli)

    const ok: any = await Mcp.mcpMessage('app', state, request(3, 'tools/call', { name: 'ok', arguments: {} }))
    expectSchema(JSONRPCResultResponseSchema, ok)
    expectSchema(CallToolResultSchema, ok.result)
    expect(ok.result.isError).toBe(false)

    const failed: any = await Mcp.mcpMessage('app', state, request(4, 'tools/call', { name: 'fail', arguments: {} }))
    expectSchema(JSONRPCResultResponseSchema, failed)
    expectSchema(CallToolResultSchema, failed.result)
    expect(failed.result.isError).toBe(true)
  })

  test('malformed requests return JSON-RPC errors and notifications produce no response', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({ ok: true }) })])
    const state = stateOf(cli)

    const missingVersion: any = await Mcp.mcpMessage('app', state, { id: 1, method: 'tools/list' })
    expectSchema(JSONRPCErrorResponseSchema, missingVersion)
    expect(missingVersion.error.code).toBe(-32600)

    const nullId: any = await Mcp.mcpMessage('app', state, { jsonrpc: '2.0', id: null, method: 'tools/list' })
    expectSchema(JSONRPCErrorResponseSchema, nullId)
    expect(nullId).not.toHaveProperty('id')

    await expect(
      Mcp.mcpMessage('app', state, { jsonrpc: '2.0', method: 'notifications/initialized' }),
    ).resolves.toBeUndefined()
  })
})
