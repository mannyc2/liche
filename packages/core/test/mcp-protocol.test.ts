import { describe, expect, test } from 'bun:test'
import { z } from '../src/index.js'
import * as Mcp from '../src/mcp/index.js'
import { stateOf, testCli, testCommand } from './helpers.js'

function request(id: string | number, method: string, params?: Record<string, unknown>) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? undefined : { params }) }
}

describe('mcpMessage — initialize', () => {
  test('returns jsonrpc "2.0" envelope with id echoed', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), request(42, 'initialize'))
    expect(res.jsonrpc).toBe('2.0')
    expect(res.id).toBe(42)
  })

  test('result.capabilities.tools is an empty object (not absent)', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), request(1, 'initialize'))
    expect(res.result.capabilities.tools).toEqual({})
  })

  test('result.protocolVersion is exactly "2025-11-25"', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), request(1, 'initialize'))
    expect(res.result.protocolVersion).toBe('2025-11-25')
  })

  test('serverInfo.name is the binary name passed in', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const res: any = await Mcp.mcpMessage('mybin', stateOf(cli), request(1, 'initialize'))
    expect(res.result.serverInfo.name).toBe('mybin')
  })

  test('serverInfo.version falls back to "0.0.0" when CLI has no version', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), request(1, 'initialize'))
    expect(res.result.serverInfo.version).toBe('0.0.0')
  })

  test('serverInfo.version preserved when set on CLI', async () => {
    const cli = testCli('app', { version: '3.1.4' }, [testCommand('run', { run: () => ({}) })])
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), request(1, 'initialize'))
    expect(res.result.serverInfo.version).toBe('3.1.4')
  })
})

describe('mcpMessage — tools/list', () => {
  test('inputSchema has type "object" and properties keyed by args+options', async () => {
    const cli = testCli('app', [testCommand('build', {
      args: z.object({ name: z.string() }),
      options: z.object({ dry: z.boolean().default(false) }),
      run: () => ({}),
    })])
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), request(1, 'tools/list'))
    const tool = res.result.tools.find((t: any) => t.name === 'build')!
    expect(tool.inputSchema.type).toBe('object')
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual(['args', 'options'])
    expect(tool.inputSchema.properties.args).toBeDefined()
    expect(tool.inputSchema.properties.options).toBeDefined()
  })

  test('jsonrpc "2.0" and id echoed', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), request(7, 'tools/list'))
    expect(res.jsonrpc).toBe('2.0')
    expect(res.id).toBe(7)
  })

  test('tool name uses underscored mcpToolName form', async () => {
    const cli = testCli('app', [testCommand(['pr', 'list'], { run: () => ({}) })])
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), request(1, 'tools/list'))
    expect(res.result.tools.map((t: any) => t.name)).toEqual(['pr_list'])
  })
})

describe('mcpMessage — tools/call', () => {
  test('successful call returns isError=false and JSON-encoded data content', async () => {
    const cli = testCli('app', [testCommand('echo', { run: () => ({ value: 1 }) })])
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'echo', arguments: {} },
    })
    expect(res.result.isError).toBe(false)
    expect(JSON.parse(res.result.content[0].text)).toEqual({ value: 1 })
    expect(res.result.content[0].type).toBe('text')
  })

  test('unknown tool returns isError=true with COMMAND_NOT_FOUND', async () => {
    const cli = testCli('app', [testCommand('echo', { run: () => ({}) })])
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'nope', arguments: {} },
    })
    expect(res.result.isError).toBe(true)
    const error = JSON.parse(res.result.content[0].text)
    expect(error.code).toBe('COMMAND_NOT_FOUND')
    expect(error.message).toBe('No tool nope')
  })

  test('root command (canonical "(root)") is callable as tool name "(root)"', async () => {
    const cli = testCli('app', { run: () => ({ rootCalled: true }) })
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: '(root)', arguments: {} },
    })
    expect(res.result.isError).toBe(false)
    expect(JSON.parse(res.result.content[0].text)).toEqual({ rootCalled: true })
  })

  test('missing params object treated as empty arguments', async () => {
    const cli = testCli('app', [testCommand('echo', { run: ({ args, options }) => ({ args, options }) })])
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'echo' },
    })
    expect(res.result.isError).toBe(false)
  })
})

describe('mcpMessage — unknown method', () => {
  test('returns jsonrpc error with code -32601 "Method not found"', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), request(99, 'unknown/method'))
    expect(res.jsonrpc).toBe('2.0')
    expect(res.id).toBe(99)
    expect(res.error).toEqual({ code: -32601, message: 'Method not found' })
    expect(res.result).toBeUndefined()
  })

  test('missing method returns an invalid request error', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), { jsonrpc: '2.0', id: 1 })
    expect(res.error.code).toBe(-32600)
  })
})
