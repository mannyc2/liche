import { describe, expect, test } from 'bun:test'
import { LiliError, middleware, z } from '../src/index.js'
import type { CliEvent } from '../src/index.js'
import * as Mcp from '../src/mcp/index.js'
import { parseJsonOutput, runCli, stateOf, testCli, testCommand } from './helpers.js'

describe('lifecycle events and hooks', () => {
  test('defineCli returns an execution instance without fluent lifecycle mutators', () => {
    const cli = testCli('app', [testCommand('ok', { run: () => ({ ok: true }) })]) as unknown as Record<string, unknown>

    expect(typeof cli['serve']).toBe('function')
    expect(typeof cli['fetch']).toBe('function')
    expect('on' in cli).toBe(false)
    expect('hook' in cli).toBe(false)
    expect('use' in cli).toBe(false)
  })

  test('emits redacted command lifecycle events to observe-only subscribers', async () => {
    const events: CliEvent[] = []
    const cli = testCli('app', {
      events: [(event) => {
        events.push(event as CliEvent)
      }],
      version: '1.2.3',
    }, [testCommand('deploy', {
        args: z.object({ target: z.string() }),
        env: z.object({ SECRET_TOKEN: z.string() }),
        options: z.object({ token: z.string() }),
        run: () => ({ value: true }),
      })])

    const result = await runCli(cli, ['deploy', 'prod', '--token', 'tok_123', '--json'], {
      env: { SECRET_TOKEN: 'env_secret' },
    })

    expect(result.exitCode).toBe(0)
    expect(parseJsonOutput(result.stdout)).toEqual({ value: true })
    expect(events.map((event) => event.type)).toEqual([
      'command.selected',
      'command.started',
      'command.completed',
    ])
    expect(events[0]).toMatchObject({
      cli: { name: 'app', version: '1.2.3' },
      command: { id: 'deploy', path: ['deploy'] },
      format: 'json',
      formatExplicit: true,
      invocation: 'cli',
    })
    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain('prod')
    expect(serialized).not.toContain('tok_123')
    expect(serialized).not.toContain('env_secret')
    expect(serialized).not.toContain('SECRET_TOKEN')
  })

  test('subscriber failures never change command results', async () => {
    const cli = testCli('app', {
      events: [{ target: 'command.started', subscriber: () => {
        throw new Error('sink down')
      } }],
    }, [testCommand('ok', {
        run: () => ({ value: true }),
      })])

    const result = await runCli(cli, ['ok', '--json'])

    expect(result.exitCode).toBe(0)
    expect(parseJsonOutput(result.stdout)).toEqual({ value: true })
    expect(result.stderr).toBe('')
  })

  test('beforeExecute hooks run before middleware and handlers', async () => {
    const cli = testCli('app', {
      hooks: {
        beforeExecute: (ctx) => {
          ;(ctx.var['trace'] as string[]).push('hook')
        },
      },
      middleware: [middleware(async (ctx, next) => {
        ;(ctx.var['trace'] as string[]).push('middleware-before')
        await next()
        ;(ctx.var['trace'] as string[]).push('middleware-after')
      })],
      vars: z.object({ trace: z.array(z.string()).default([]) }),
    }, [testCommand('trace', {
      run: ({ var: vars }) => {
        ;(vars['trace'] as string[]).push('handler')
        return { trace: vars['trace'] }
      },
    })])

    const result = await runCli(cli, ['trace', '--json'])

    expect(result.exitCode).toBe(0)
    expect(parseJsonOutput(result.stdout)).toEqual({
      trace: ['hook', 'middleware-before', 'handler', 'middleware-after'],
    })
  })

  test('construction-time events and hooks seed the same lifecycle lanes', async () => {
    const events: CliEvent[] = []
    const cli = testCli({
      name: 'app',
      events: [(event) => {
        events.push(event as CliEvent)
      }],
      hooks: {
        beforeExecute: (ctx) => ctx.set('fromHook', true),
      },
      vars: z.object({ fromHook: z.boolean().default(false) }),
    }, [testCommand('show', {
      run: ({ var: vars }) => ({ fromHook: vars['fromHook'] }),
    })])

    const result = await runCli(cli, ['show', '--json'])

    expect(result.exitCode).toBe(0)
    expect(parseJsonOutput(result.stdout)).toEqual({ fromHook: true })
    expect(events.map((event) => event.type)).toEqual([
      'command.selected',
      'command.started',
      'command.completed',
    ])
  })

  test('hook failures normalize as command failures', async () => {
    const events: CliEvent[] = []
    const cli = testCli('app', {
      events: [(event) => {
        events.push(event as CliEvent)
      }],
      hooks: {
        beforeExecute: () => {
          throw new LiliError({ code: 'HOOK_FAILED', message: 'policy denied' })
        },
      },
    }, [testCommand('blocked', {
        run: () => ({ shouldNotRun: true }),
      })])

    const result = await runCli(cli, ['blocked', '--json'])

    expect(result.exitCode).toBe(1)
    expect(parseJsonOutput(result.stdout)).toMatchObject({
      ok: false,
      data: null,
      error: {
        code: 'HOOK_FAILED',
        message: 'policy denied',
      },
    })
    expect(events.map((event) => event.type)).toEqual([
      'command.selected',
      'command.started',
      'hook.failed',
      'command.failed',
    ])
    expect(events.find((event) => event.type === 'hook.failed')?.error).toMatchObject({ code: 'HOOK_FAILED' })
  })

  test('validation failure events omit raw field errors and messages', async () => {
    const events: CliEvent[] = []
    const cli = testCli('app', {
      events: [(event) => {
        events.push(event as CliEvent)
      }],
    }, [testCommand('token', {
        env: z.object({ TOKEN: z.string() }),
        run: ({ env }) => ({ token: env.TOKEN }),
      })])

    const result = await runCli(cli, ['token', '--json'], { env: {} })

    expect(result.exitCode).toBe(1)
    expect(events.map((event) => event.type)).toEqual([
      'command.selected',
      'command.started',
      'validation.failed',
      'command.failed',
    ])
    const validation = events.find((event) => event.type === 'validation.failed')
    expect(validation?.error).toEqual({ code: 'VALIDATION_ERROR', exitCode: 1, fieldErrorCount: 1 })
    expect(JSON.stringify(events)).not.toContain('TOKEN')
    expect(JSON.stringify(events)).not.toContain('Required')
  })

  test('emits local-only lifecycle events for pre-execution surfaces', async () => {
    const events: CliEvent[] = []
    const cli = testCli('app', {
      builtins: { completions: true },
      events: [(event) => {
        events.push(event as CliEvent)
      }],
      version: '1.2.3',
    }, [testCommand('show', {
        run: () => ({ value: true }),
      })])

    await runCli(cli, ['show', '--help'])
    await runCli(cli, ['--version'])
    await runCli(cli, ['show', '--schema', '--json'])
    await runCli(cli, ['secret-command-name'])
    await runCli(cli, [], { env: { COMPLETE: 'bash' } })
    await runCli(cli, ['completions', 'bash'])

    expect(events.map((event) => event.type)).toEqual([
      'help.rendered',
      'version.rendered',
      'schema.generated',
      'command.not_found',
      'help.rendered',
      'completion.generated',
      'completion.generated',
    ])
    expect(events.find((event) => event.type === 'schema.generated')?.command).toEqual({ id: 'show', path: ['show'] })
    expect(events.filter((event) => event.type === 'completion.generated').map((event) => event.completion?.shell)).toEqual([
      'bash',
      'bash',
    ])
    expect(JSON.stringify(events)).not.toContain('secret-command-name')
  })

  test('parse failure events omit raw global flag values', async () => {
    const events: CliEvent[] = []
    const cli = testCli('app', {
      events: [(event) => {
        events.push(event as CliEvent)
      }],
    }, [testCommand('show', {
        run: () => ({ value: true }),
      })])

    const result = await runCli(cli, ['--format', 'secret-format'])

    expect(result.exitCode).toBe(1)
    expect(events.map((event) => event.type)).toEqual(['parse.failed'])
    expect(events[0]?.error).toEqual({ code: 'PARSE_ERROR', exitCode: 1 })
    expect(JSON.stringify(events)).not.toContain('secret-format')
  })

  test('MCP lifecycle events omit request arguments and unknown tool names', async () => {
    const events: CliEvent[] = []
    const cli = testCli('app', {
      events: [(event) => {
        events.push(event as CliEvent)
      }],
    }, [testCommand('echo', {
        args: z.object({ secret: z.string().optional() }),
        options: z.object({ token: z.string().optional() }),
        run: () => ({ ok: true }),
      })])

    await Mcp.mcpMessage('app', stateOf(cli), { jsonrpc: '2.0', id: 1, method: 'initialize' })
    await Mcp.mcpMessage('app', stateOf(cli), { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    await Mcp.mcpMessage('app', stateOf(cli), {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        arguments: { args: { secret: 'request_secret' }, options: { token: 'tok_123' } },
        name: 'echo',
      },
    })
    await Mcp.mcpMessage('app', stateOf(cli), {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { arguments: {}, name: 'secret_tool_name' },
    })

    expect(events.map((event) => event.type)).toEqual([
      'mcp.initialize',
      'mcp.tools_listed',
      'mcp.tool_call.started',
      'command.selected',
      'command.started',
      'command.completed',
      'mcp.tool_call.completed',
      'mcp.tool_call.failed',
    ])
    expect(events.find((event) => event.type === 'mcp.tools_listed')?.mcp).toEqual({
      method: 'tools/list',
      toolCount: 1,
    })
    expect(events.find((event) => event.type === 'mcp.tool_call.started')?.command).toEqual({
      id: 'echo',
      path: ['echo'],
    })
    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain('request_secret')
    expect(serialized).not.toContain('tok_123')
    expect(serialized).not.toContain('secret_tool_name')
  })

  test('telemetry sinks can consume the documented allowlist without forwarding every local event', async () => {
    const localEvents: CliEvent[] = []
    const telemetryEvents: CliEvent[] = []
    const telemetryAllowlist = new Set<CliEvent['type']>([
      'command.started',
      'command.completed',
      'command.failed',
      'validation.failed',
    ])
    const cli = testCli('app', {
      events: [(event) => {
        localEvents.push(event as CliEvent)
        if (telemetryAllowlist.has(event.type)) telemetryEvents.push(event as CliEvent)
      }],
    }, [testCommand('ok', {
        run: () => ({ ok: true }),
      })])

    await runCli(cli, ['ok', '--help'])
    await runCli(cli, ['ok', '--json'])

    expect(localEvents.map((event) => event.type)).toEqual([
      'help.rendered',
      'command.selected',
      'command.started',
      'command.completed',
    ])
    expect(telemetryEvents.map((event) => event.type)).toEqual([
      'command.started',
      'command.completed',
    ])
  })
})
