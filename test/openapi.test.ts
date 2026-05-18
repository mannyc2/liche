import { describe, expect, test } from 'bun:test'
import { Cli, z } from '../src/index.js'
import { stateSymbol, type InternalCli } from '../src/cli/create.js'
import { emitOpenApi, ingestOpenApi } from '../src/command/openapi.js'

const stateOf = (cli: any) => (cli as InternalCli)[stateSymbol]

describe('emitOpenApi', () => {
  test('root command maps to "/" path key (not "/(root)")', () => {
    const cli = Cli.create('app', { run: () => ({ ok: true }) })
    const spec = emitOpenApi('app', stateOf(cli)) as any
    expect(Object.keys(spec.paths)).toEqual(['/'])
  })

  test('nested command "pr list" maps to "/pr/list" path key', () => {
    const pr = Cli.create('pr').command('list', { run: () => ({ ok: true }) })
    const cli = Cli.create('app').command(pr)
    const spec = emitOpenApi('app', stateOf(cli)) as any
    expect(Object.keys(spec.paths)).toEqual(['/pr/list'])
  })

  test('multi-word command operationId joins with underscores', () => {
    const pr = Cli.create('pr')
      .command('list', { run: () => ({ ok: true }) })
      .command('view', { run: () => ({ ok: true }) })
    const cli = Cli.create('app').command(pr)
    const spec = emitOpenApi('app', stateOf(cli)) as any
    expect(spec.paths['/pr/list'].post.operationId).toBe('pr_list')
    expect(spec.paths['/pr/view'].post.operationId).toBe('pr_view')
  })

  test('info.description is "" when CLI has no description', () => {
    const cli = Cli.create('app', { version: '1.0.0', run: () => ({ ok: true }) })
    const spec = emitOpenApi('app', stateOf(cli)) as any
    expect(spec.info.description).toBe('')
  })

  test('info.description preserved verbatim', () => {
    const cli = Cli.create('app', { description: 'docs here', version: '1.0.0', run: () => ({ ok: true }) })
    const spec = emitOpenApi('app', stateOf(cli)) as any
    expect(spec.info.description).toBe('docs here')
  })

  test('info.version falls back to "0.0.0" when omitted', () => {
    const cli = Cli.create('app', { run: () => ({ ok: true }) })
    const spec = emitOpenApi('app', stateOf(cli)) as any
    expect(spec.info.version).toBe('0.0.0')
  })

  test('openapi version is fixed at "3.1.0"', () => {
    const cli = Cli.create('app', { run: () => ({ ok: true }) })
    const spec = emitOpenApi('app', stateOf(cli)) as any
    expect(spec.openapi).toBe('3.1.0')
  })

  test('200 response schema has ok={const:true,type:"boolean"} and required=["ok","data"]', () => {
    const cli = Cli.create('app').command('users', { run: () => ({ ok: true }) })
    const spec = emitOpenApi('app', stateOf(cli)) as any
    const schema = spec.paths['/users'].post.responses['200'].content['application/json'].schema
    expect(schema.properties.ok).toEqual({ const: true, type: 'boolean' })
    expect(schema.required).toEqual(['ok', 'data'])
    expect(schema.type).toBe('object')
  })

  test('400 response schema has ok={const:false}', () => {
    const cli = Cli.create('app').command('users', { run: () => ({ ok: true }) })
    const spec = emitOpenApi('app', stateOf(cli)) as any
    const schema = spec.paths['/users'].post.responses['400'].content['application/json'].schema
    expect(schema.properties.ok).toEqual({ const: false })
  })

  test('command with args only: requestBody.properties has args, no options key', () => {
    const cli = Cli.create('app').command('users', {
      args: z.object({ id: z.string() }),
      run: () => ({ ok: true }),
    })
    const spec = emitOpenApi('app', stateOf(cli)) as any
    const props = spec.paths['/users'].post.requestBody.content['application/json'].schema.properties
    expect(Object.keys(props)).toEqual(['args'])
  })

  test('command with options only: requestBody.properties has options, no args key', () => {
    const cli = Cli.create('app').command('users', {
      options: z.object({ active: z.boolean().default(false) }),
      run: () => ({ ok: true }),
    })
    const spec = emitOpenApi('app', stateOf(cli)) as any
    const props = spec.paths['/users'].post.requestBody.content['application/json'].schema.properties
    expect(Object.keys(props)).toEqual(['options'])
  })

  test('command with neither args nor options: requestBody.properties is empty object', () => {
    const cli = Cli.create('app').command('users', { run: () => ({ ok: true }) })
    const spec = emitOpenApi('app', stateOf(cli)) as any
    const props = spec.paths['/users'].post.requestBody.content['application/json'].schema.properties
    expect(props).toEqual({})
  })

  test('summary defaults to "" when description omitted', () => {
    const cli = Cli.create('app').command('users', { run: () => ({ ok: true }) })
    const spec = emitOpenApi('app', stateOf(cli)) as any
    expect(spec.paths['/users'].post.summary).toBe('')
  })

  test('summary equals command description when present', () => {
    const cli = Cli.create('app').command('users', {
      description: 'list users',
      run: () => ({ ok: true }),
    })
    const spec = emitOpenApi('app', stateOf(cli)) as any
    expect(spec.paths['/users'].post.summary).toBe('list users')
  })
})

describe('ingestOpenApi', () => {
  test('returns [] for spec with no paths', () => {
    expect(ingestOpenApi({})).toEqual([])
  })

  test('filters out non-HTTP methods (head, options, trace, summary, parameters)', () => {
    const operations = ingestOpenApi({
      paths: {
        '/x': {
          get: { operationId: 'x' },
          head: { operationId: 'xh' },
          options: { operationId: 'xo' },
          trace: { operationId: 'xt' },
        },
      },
    })
    expect(operations.length).toBe(1)
    expect(operations[0]!.method).toBe('GET')
    expect(operations[0]!.operationId).toBe('x')
  })

  test('accepts all five supported methods', () => {
    const ops = ingestOpenApi({
      paths: {
        '/a': { get: {}, post: {}, put: {}, patch: {}, delete: {} },
      },
    })
    expect(ops.map((o) => o.method).sort()).toEqual(['DELETE', 'GET', 'PATCH', 'POST', 'PUT'])
  })

  test('method is uppercased', () => {
    const [op] = ingestOpenApi({ paths: { '/x': { post: {} } } })
    expect(op!.method).toBe('POST')
  })

  test('separates path and query parameters', () => {
    const [op] = ingestOpenApi({
      paths: {
        '/u/{id}': {
          get: {
            parameters: [
              { in: 'path', name: 'id' },
              { in: 'query', name: 'active' },
              { in: 'query', name: 'limit' },
              { in: 'header', name: 'authorization' },
            ],
          },
        },
      },
    })
    expect(op!.args).toEqual(['id'])
    expect(op!.queryKeys).toEqual(['active', 'limit'])
  })

  test('extracts body keys from requestBody.application/json.schema.properties', () => {
    const [op] = ingestOpenApi({
      paths: {
        '/u': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: { type: 'object', properties: { name: {}, age: {} } } },
              },
            },
          },
        },
      },
    })
    expect(op!.bodyKeys).toEqual(['name', 'age'])
  })

  test('bodyKeys is [] when requestBody is missing', () => {
    const [op] = ingestOpenApi({ paths: { '/u': { post: {} } } })
    expect(op!.bodyKeys).toEqual([])
  })

  test('preserves operationId when present', () => {
    const [op] = ingestOpenApi({ paths: { '/u': { get: { operationId: 'getUser' } } } })
    expect(op!.operationId).toBe('getUser')
  })

  test('operationId is undefined when not in spec', () => {
    const [op] = ingestOpenApi({ paths: { '/u': { get: {} } } })
    expect(op!.operationId).toBeUndefined()
  })
})
