import { describe, expect, test } from 'bun:test'
import { Cli, Mcp, z } from '../src/index.js'
import { stateOf } from './helpers.js'

describe('mcpMessage — initialize', () => {
  test('returns jsonrpc "2.0" envelope with id echoed', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), { id: 42, method: 'initialize' })
    expect(res.jsonrpc).toBe('2.0')
    expect(res.id).toBe(42)
  })

  test('result.capabilities.tools is an empty object (not absent)', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), { id: 1, method: 'initialize' })
    expect(res.result.capabilities.tools).toEqual({})
  })

  test('result.protocolVersion is exactly "2025-06-18"', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), { id: 1, method: 'initialize' })
    expect(res.result.protocolVersion).toBe('2025-06-18')
  })

  test('serverInfo.name is the binary name passed in', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const res: any = await Mcp.mcpMessage('mybin', stateOf(cli), { id: 1, method: 'initialize' })
    expect(res.result.serverInfo.name).toBe('mybin')
  })

  test('serverInfo.version falls back to "0.0.0" when CLI has no version', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), { id: 1, method: 'initialize' })
    expect(res.result.serverInfo.version).toBe('0.0.0')
  })

  test('serverInfo.version preserved when set on CLI', async () => {
    const cli = Cli.create('app', { version: '3.1.4' }).command('run', { run: () => ({}) })
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), { id: 1, method: 'initialize' })
    expect(res.result.serverInfo.version).toBe('3.1.4')
  })
})

describe('mcpMessage — tools/list', () => {
  test('inputSchema has type "object" and properties keyed by args+options', async () => {
    const cli = Cli.create('app').command('build', {
      args: z.object({ name: z.string() }),
      options: z.object({ dry: z.boolean().default(false) }),
      run: () => ({}),
    })
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), { id: 1, method: 'tools/list' })
    const tool = res.result.tools.find((t: any) => t.name === 'build')!
    expect(tool.inputSchema.type).toBe('object')
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual(['args', 'options'])
    expect(tool.inputSchema.properties.args).toBeDefined()
    expect(tool.inputSchema.properties.options).toBeDefined()
  })

  test('jsonrpc "2.0" and id echoed', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), { id: 7, method: 'tools/list' })
    expect(res.jsonrpc).toBe('2.0')
    expect(res.id).toBe(7)
  })

  test('tool name uses underscored mcpToolName form', async () => {
    const pr = Cli.create('pr').command('list', { run: () => ({}) })
    const cli = Cli.create('app').command(pr)
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), { id: 1, method: 'tools/list' })
    expect(res.result.tools.map((t: any) => t.name)).toEqual(['pr_list'])
  })
})

describe('mcpMessage — tools/call', () => {
  test('successful call returns isError=false and JSON-encoded data content', async () => {
    const cli = Cli.create('app').command('echo', { run: () => ({ value: 1 }) })
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), {
      id: 1,
      method: 'tools/call',
      params: { name: 'echo', arguments: {} },
    })
    expect(res.result.isError).toBe(false)
    expect(JSON.parse(res.result.content[0].text)).toEqual({ value: 1 })
    expect(res.result.content[0].type).toBe('text')
  })

  test('unknown tool returns isError=true with COMMAND_NOT_FOUND', async () => {
    const cli = Cli.create('app').command('echo', { run: () => ({}) })
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), {
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
    const cli = Cli.create('app', { run: () => ({ rootCalled: true }) })
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), {
      id: 1,
      method: 'tools/call',
      params: { name: '(root)', arguments: {} },
    })
    expect(res.result.isError).toBe(false)
    expect(JSON.parse(res.result.content[0].text)).toEqual({ rootCalled: true })
  })

  test('missing params object treated as empty arguments', async () => {
    const cli = Cli.create('app').command('echo', { run: ({ args, options }) => ({ args, options }) })
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), {
      id: 1,
      method: 'tools/call',
      params: { name: 'echo' },
    })
    expect(res.result.isError).toBe(false)
  })
})

describe('mcpMessage — unknown method', () => {
  test('returns jsonrpc error with code -32601 "Method not found"', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), { id: 99, method: 'unknown/method' })
    expect(res.jsonrpc).toBe('2.0')
    expect(res.id).toBe(99)
    expect(res.error).toEqual({ code: -32601, message: 'Method not found' })
    expect(res.result).toBeUndefined()
  })

  test('missing method returns the same error', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const res: any = await Mcp.mcpMessage('app', stateOf(cli), { id: 1 })
    expect(res.error.code).toBe(-32601)
  })
})
