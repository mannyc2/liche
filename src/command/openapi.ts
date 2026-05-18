import type { CliState, CommandManifestEntry, Dict } from '../types.js'
import { collectCommands } from './registry.js'

export function emitOpenApi(name: string, state: CliState): Dict {
  const commands = collectCommands(state.commands, state.root)
  const paths: Dict = {}
  for (const command of commands) {
    const route = command.name === '(root)' ? '/' : `/${command.name.split(' ').join('/')}`
    paths[route] = { post: operation(command) }
  }
  return {
    openapi: '3.1.0',
    info: { description: state.def.description ?? '', title: name, version: state.def.version ?? '0.0.0' },
    paths,
  }
}

function operation(command: CommandManifestEntry): Dict {
  const schema = (command.schema ?? {}) as { args?: unknown; options?: unknown; output?: unknown }
  const properties: Dict = {}
  if (schema.args) properties['args'] = schema.args
  if (schema.options) properties['options'] = schema.options
  return {
    operationId: command.name.replace(/\s+/g, '_'),
    summary: command.description ?? '',
    requestBody: {
      content: {
        'application/json': { schema: { type: 'object', properties } },
      },
    },
    responses: {
      '200': {
        description: 'Successful execution envelope.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                ok: { const: true, type: 'boolean' },
                data: schema.output ?? {},
              },
              required: ['ok', 'data'],
            },
          },
        },
      },
      '400': {
        description: 'Validation error envelope.',
        content: {
          'application/json': {
            schema: { type: 'object', properties: { ok: { const: false }, error: { type: 'object' } } },
          },
        },
      },
    },
  }
}

export type OperationDescriptor = {
  args: string[]
  bodyKeys: string[]
  method: string
  operationId?: string | undefined
  path: string
  queryKeys: string[]
}

export function ingestOpenApi(spec: Dict): OperationDescriptor[] {
  const paths = (spec['paths'] ?? {}) as Dict<Dict>
  const operations: OperationDescriptor[] = []
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods as Dict<Dict>)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue
      const params = (op['parameters'] ?? []) as Array<Dict>
      const args = params.filter((p) => p['in'] === 'path').map((p) => String(p['name']))
      const queryKeys = params.filter((p) => p['in'] === 'query').map((p) => String(p['name']))
      const body = op['requestBody'] as Dict | undefined
      const bodyKeys = bodyKeysFrom(body)
      operations.push({
        args,
        bodyKeys,
        method: method.toUpperCase(),
        operationId: op['operationId'] as string | undefined,
        path,
        queryKeys,
      })
    }
  }
  return operations
}

function bodyKeysFrom(body: Dict | undefined): string[] {
  if (!body) return []
  const content = body['content'] as Dict<Dict> | undefined
  const json = content?.['application/json']?.['schema'] as Dict | undefined
  const props = (json?.['properties'] ?? {}) as Dict
  return Object.keys(props)
}
