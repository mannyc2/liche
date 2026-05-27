import type { CliState } from '../types.js'
import { execute } from './execute.js'
import { selectCommand } from '../command/registry.js'
import { isObject } from '../internal.js'
import { defaultEnv } from './invocation.js'
import { createLifecycleEvent, emitLifecycleEvent, mergeHooks } from './lifecycle.js'
import { checkCommandSurface, unsupportedSurfaceError } from '../schema/surface.js'
import { fail } from '../errors/result.js'

export async function fetchCli(name: string, state: CliState, request: Request): Promise<Response> {
  const url = new URL(request.url)

  for (const route of state.fetchRoutes) {
    if (route.match(url)) return await route.handle({ binaryName: name, request, state, url })
  }

  const path = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const selected = selectCommand(state, path)
  if (!selected) {
    await emitLifecycleEvent(state.events, createLifecycleEvent(name, state.def.version, {
      isTty: false,
      error: { code: 'COMMAND_NOT_FOUND', status: 404 },
      format: 'json',
      formatExplicit: true,
      surface: { kind: 'command' },
      type: 'command.not_found',
    }))
    return Response.json(
      { ok: false, data: null, error: { code: 'COMMAND_NOT_FOUND', message: `No command for ${url.pathname}` } },
      { status: 404 },
    )
  }

  const surfaceCheck = checkCommandSurface(selected.entry, 'fetch')
  if (!surfaceCheck.ok) {
    const error = unsupportedSurfaceError(surfaceCheck)
    await emitLifecycleEvent(state.events, createLifecycleEvent(name, state.def.version, {
      isTty: false,
      error: { code: 'UNSUPPORTED_SURFACE', status: 400 },
      format: 'json',
      formatExplicit: true,
      surface: { kind: 'command' },
      type: 'command.unsupported_surface',
    }))
    return Response.json(fail(error), { status: 400 })
  }

  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await safeJson(request)
  const query = Object.fromEntries(url.searchParams.entries())
  const wantsStream = (request.headers.get('accept') ?? '').includes('application/x-ndjson')

  if (wantsStream) {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const result = await execute(name, selected, {
          argvOptions: { args: selected.argv.args, options: { ...query, ...(isObject(body) ? body : {}) } },
          displayName: name,
          events: state.events.concat(selected.events),
          env: defaultEnv(),
          flags: {},
          format: 'jsonl',
          formatExplicit: true,
          global: {},
          hooks: mergeHooks(state.hooks, selected.hooks),
          inputSources: state.inputSources,
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
    argvOptions: { args: selected.argv.args, options: { ...query, ...(isObject(body) ? body : {}) } },
    displayName: name,
    events: state.events.concat(selected.events),
    env: defaultEnv(),
    flags: {},
    format: 'json',
    formatExplicit: true,
    global: {},
    hooks: mergeHooks(state.hooks, selected.hooks),
    inputSources: state.inputSources,
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
