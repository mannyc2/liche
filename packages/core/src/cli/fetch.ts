import type { CliState, Dict } from '../types.js'
import { execute } from './execute.js'
import { selectCommand } from '../command/registry.js'
import { handleMcpHttp } from '../mcp/http.js'
import { isObject } from '../internal.js'
import { createLifecycleEvent, emitLifecycleEvent, mergeHooks } from './lifecycle.js'

export async function fetchCli(name: string, state: CliState, request: Request): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/mcp') return await handleMcpHttp(name, state, request)

  const path = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const selected = selectCommand(state, path)
  if (!selected) {
    await emitLifecycleEvent(state.events, createLifecycleEvent(name, state.def.version, {
      agent: true,
      error: { code: 'COMMAND_NOT_FOUND', status: 404 },
      format: 'json',
      formatExplicit: true,
      invocation: 'agent',
      surface: { kind: 'command' },
      type: 'command.not_found',
    }))
    return Response.json(
      { ok: false, data: null, error: { code: 'COMMAND_NOT_FOUND', message: `No command for ${url.pathname}` } },
      { status: 404 },
    )
  }

  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await safeJson(request)
  const query = Object.fromEntries(url.searchParams.entries())
  const wantsStream = (request.headers.get('accept') ?? '').includes('application/x-ndjson')

  if (wantsStream) {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const result = await execute(name, selected, {
          agent: true,
          argvOptions: { args: selected.argv.args, options: { ...query, ...(isObject(body) ? body : {}) } },
          displayName: name,
          events: state.events.concat(selected.events),
          env: Bun.env as Dict<string | undefined>,
          format: 'jsonl',
          formatExplicit: true,
          global: {},
          hooks: mergeHooks(state.hooks, selected.hooks),
          invocation: 'agent',
          isTty: false,
          middlewares: state.middlewares.concat(selected.middlewares),
          onChunk: (chunk) => {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'chunk', data: chunk })}\n`))
          },
          version: state.def.version,
        })
        controller.enqueue(encoder.encode(`${JSON.stringify(result)}\n`))
        controller.close()
      },
    })
    return new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } })
  }

  const result = await execute(name, selected, {
    agent: true,
    argvOptions: { args: selected.argv.args, options: { ...query, ...(isObject(body) ? body : {}) } },
    displayName: name,
    events: state.events.concat(selected.events),
    env: Bun.env as Dict<string | undefined>,
    format: 'json',
    formatExplicit: true,
    global: {},
    hooks: mergeHooks(state.hooks, selected.hooks),
    invocation: 'agent',
    isTty: false,
    middlewares: state.middlewares.concat(selected.middlewares),
    version: state.def.version,
  })

  return Response.json(result, { status: result.ok ? 200 : Number(result.error.status ?? 400) })
}

async function safeJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
