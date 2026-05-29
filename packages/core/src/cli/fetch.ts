import type { CliState, FieldErrorSource } from '../types.js'
import { execute } from './execute.js'
import { selectCommand } from '../command/registry.js'
import { isObject } from '../internal.js'
import { defaultEnv } from './invocation.js'
import { createLifecycleEvent, emitLifecycleEvent, eventCommand, mergeHooks } from './lifecycle.js'
import { checkCommandSurface, unsupportedSurfaceError } from '../schema/surface.js'
import { fail } from '../errors/result.js'
import { nonInteractiveStdio, streamKinds } from './stdio.js'

// A fetch invocation has no terminal: fixed non-interactive stdio for events/execute.
const FETCH_STDIO = nonInteractiveStdio()
const FETCH_STREAMS = streamKinds(FETCH_STDIO)

export async function fetchCli(name: string, state: CliState, request: Request): Promise<Response> {
  const url = new URL(request.url)

  for (const route of state.fetchRoutes) {
    if (route.match(url)) return await route.handle({ binaryName: name, request, state, url })
  }

  const path = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const selected = selectCommand(state, path)
  if (!selected) {
    await emitLifecycleEvent(state.events, createLifecycleEvent(name, state.def.version, {
      streams: FETCH_STREAMS,
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
      streams: FETCH_STREAMS,
      error: { code: 'UNSUPPORTED_SURFACE', status: 400 },
      format: 'json',
      formatExplicit: true,
      surface: { kind: 'command' },
      type: 'command.unsupported_surface',
    }))
    return Response.json(fail(error), { status: 400 })
  }

  const parsed = request.method === 'GET' || request.method === 'HEAD' ? { kind: 'empty' as const } : await readBody(request)
  if (parsed.kind === 'invalid') {
    await emitLifecycleEvent(state.events.concat(selected.events), createLifecycleEvent(name, state.def.version, {
      streams: FETCH_STREAMS,
      command: eventCommand(selected),
      error: { code: 'INVALID_REQUEST_BODY', exitCode: 1, status: 400 },
      exitCode: 1,
      format: 'json',
      formatExplicit: true,
      result: 'user_error',
      surface: { kind: 'parse' },
      type: 'parse.failed',
    }))
    return Response.json(
      fail({ code: 'INVALID_REQUEST_BODY', message: 'Request body is not valid JSON', status: 400 }),
      { status: 400 },
    )
  }
  const body = parsed.kind === 'parsed' ? parsed.value : undefined
  const query = Object.fromEntries(url.searchParams.entries())
  const bodyEntries = isObject(body) ? body : {}
  const mergedOptions = { ...query, ...bodyEntries }
  const optionHints: Record<string, FieldErrorSource> = {}
  for (const key of Object.keys(query)) optionHints[key] = { kind: 'fetch-query', key }
  for (const key of Object.keys(bodyEntries)) optionHints[key] = { kind: 'fetch-body', key }
  const wantsStream = (request.headers.get('accept') ?? '').includes('application/x-ndjson')

  if (wantsStream) {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const result = await execute(name, selected, {
          argvOptions: { args: selected.argv.args, options: mergedOptions },
          displayName: name,
          events: state.events.concat(selected.events),
          env: defaultEnv(),
          flags: {},
          format: 'jsonl',
          formatExplicit: true,
          global: {},
          hooks: mergeHooks(state.hooks, selected.hooks),
          inputSources: state.inputSources,
          inputSourceHints: { options: optionHints },
          stdio: FETCH_STDIO,
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
    argvOptions: { args: selected.argv.args, options: mergedOptions },
    displayName: name,
    events: state.events.concat(selected.events),
    env: defaultEnv(),
    flags: {},
    format: 'json',
    formatExplicit: true,
    global: {},
    hooks: mergeHooks(state.hooks, selected.hooks),
    inputSources: state.inputSources,
    inputSourceHints: { options: optionHints },
    stdio: FETCH_STDIO,
    middlewares: state.middlewares.concat(selected.middlewares),
    version: state.def.version,
  })

  return Response.json(result, { status: result.ok ? 200 : Number(result.error.status ?? 400) })
}

type ParsedBody =
  | { kind: 'empty' }
  | { kind: 'parsed'; value: unknown }
  | { kind: 'invalid' }

async function readBody(request: Request): Promise<ParsedBody> {
  const raw = await request.text()
  if (raw.length === 0) return { kind: 'empty' }
  try {
    return { kind: 'parsed', value: JSON.parse(raw) }
  } catch {
    return { kind: 'invalid' }
  }
}
