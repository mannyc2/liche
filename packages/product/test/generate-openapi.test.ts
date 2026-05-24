import { describe, expect, test } from 'bun:test'
import {
  Auth,
  Command,
  Field,
  Shape,
  canonicalDigest,
  defineProduct,
  generateOpenapi,
  normalizeProduct,
} from '../src/index.js'
import type { Catalog } from '../src/index.js'
import workersProduct from './fixtures/workers.product.js'

function generate(catalog: Catalog, surfaceId = 'openapi'): string {
  return generateOpenapi(catalog, {
    generatorVersion: '0.0.0',
    canonicalIrDigest: canonicalDigest(catalog),
    generationOptionsDigest: canonicalDigest({
      surfaceId,
      openapiFileName: 'liche.generated.openapi.json',
      manifestFileName: 'liche.generated.manifest.json',
    }),
    surfaceId,
  })
}

describe('generateOpenapi — golden fixture', () => {
  test('matches checked-in workers.generated.openapi.json byte-for-byte', async () => {
    const catalog = normalizeProduct(workersProduct)
    const golden = await Bun.file(
      new URL('./fixtures/workers.generated.openapi.json', import.meta.url),
    ).text()
    expect(generate(catalog)).toBe(golden)
  })

  test('produces byte-identical output on repeated invocations (deterministic)', () => {
    const catalog = normalizeProduct(workersProduct)
    expect(generate(catalog)).toBe(generate(catalog))
  })
})

describe('generateOpenapi — document shape', () => {
  test('header carries openapi 3.1.0 plus liche catalog + options digests', () => {
    const catalog = normalizeProduct(workersProduct)
    const doc = JSON.parse(generate(catalog))
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info.title).toBe('Workers')
    expect(doc.info.version).toBe('1.0.0')
    expect(doc.info['x-liche-catalog-digest']).toBe(canonicalDigest(catalog))
    expect(doc.info['x-liche-generator-version']).toBe('0.0.0')
    expect(doc.info['x-liche-surface-id']).toBe('openapi')
  })

  test('omits info.description when the product has none', () => {
    const product = defineProduct({
      id: 'p',
      name: 'P',
      version: '0.1.0',
      auth: Auth.none(),
      resources: {
        thing: {
          label: 't',
          path: '/things',
          fields: { id: Field.string('ID').identifier() },
          operations: {
            list: {
              summary: 'List',
              http: { method: 'GET', path: '' },
              output: Shape.list('thing'),
            },
          },
        },
      },
    })
    const doc = JSON.parse(generate(normalizeProduct(product)))
    expect(doc.info.description).toBeUndefined()
  })
})

describe('generateOpenapi — capability filter', () => {
  test('only resource operations appear in paths; commands are excluded', () => {
    const doc = JSON.parse(generate(normalizeProduct(workersProduct)))
    const paths = Object.keys(doc.paths)
    expect(paths).toEqual(['/workers/scripts'])
    const operationIds = Object.values(doc.paths).flatMap((byMethod) =>
      Object.values(byMethod as Record<string, { operationId: string }>).map(
        (op) => op.operationId,
      ),
    )
    expect(operationIds).toEqual(['script.list'])
    expect(Object.keys(doc.components.schemas)).toEqual(['script'])
  })

  test('hybrid-workflow command with an HTTP trigger is still excluded in this phase', () => {
    const product = defineProduct({
      id: 'p',
      name: 'P',
      version: '0.1.0',
      auth: Auth.none(),
      commands: {
        deploy: Command.workflow({
          summary: 'Deploy',
          handler: 'wrangler.deploy',
          http: { method: 'POST', path: '/deploy' },
          surfaces: { openapi: true },
          steps: [{ id: 'bundle', label: 'Bundle', uses: 'local' }],
        }),
      },
    })
    const doc = JSON.parse(generate(normalizeProduct(product)))
    expect(doc.paths).toEqual({})
  })

  test('resource operations with surfaces.openapi=false do not appear in paths', () => {
    const product = defineProduct({
      id: 'p',
      name: 'P',
      version: '0.1.0',
      auth: Auth.none(),
      resources: {
        thing: {
          label: 't',
          path: '/things',
          fields: { id: Field.string('ID').identifier() },
          operations: {
            list: {
              summary: 'List',
              http: { method: 'GET', path: '' },
              output: Shape.list('thing'),
              surfaces: { openapi: false },
            },
          },
        },
      },
    })
    const doc = JSON.parse(generate(normalizeProduct(product)))
    expect(doc.paths).toEqual({})
  })
})

describe('generateOpenapi — list output schemas', () => {
  test('list output projects to $ref into components.schemas.<resource>', () => {
    const doc = JSON.parse(generate(normalizeProduct(workersProduct)))
    const ok = doc.paths['/workers/scripts'].get.responses['200']
    expect(ok.content['application/json'].schema).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/script' },
    })
    expect(doc.components.schemas.script.type).toBe('object')
  })

  test('component schema preserves liche vendor extensions on fields', () => {
    const doc = JSON.parse(generate(normalizeProduct(workersProduct)))
    const script = doc.components.schemas.script
    expect(script.properties.id['x-liche-identifier']).toBe(true)
    expect(script.properties.id['x-liche-mutability']).toBe('immutable')
    expect(script.properties.name['x-liche-human-label']).toBe(true)
    expect(script.properties.created_at['x-liche-mutability']).toBe('immutable')
    expect(script.required).toEqual(['id', 'name'])
  })

  test('list shape pointing at an undeclared resource throws loudly', () => {
    const product = defineProduct({
      id: 'p',
      name: 'P',
      version: '0.1.0',
      auth: Auth.none(),
      resources: {
        thing: {
          label: 't',
          path: '/things',
          fields: { id: Field.string('ID').identifier() },
          operations: {
            list: {
              summary: 'List',
              http: { method: 'GET', path: '' },
              output: Shape.list('ghost'),
            },
          },
        },
      },
    })
    expect(() => generate(normalizeProduct(product))).toThrow(
      /resource 'ghost' is not declared in this catalog/,
    )
  })
})

describe('generateOpenapi — path, query, header, body binding', () => {
  test('path params become parameters with required:true and schema from input', () => {
    const product = defineProduct({
      id: 'p',
      name: 'P',
      version: '0.1.0',
      auth: Auth.none(),
      resources: {
        script: {
          label: 's',
          path: '/workers/scripts',
          fields: {
            id: Field.string('ID').identifier(),
            name: Field.string('Name').humanLabel(),
          },
          operations: {
            get: {
              summary: 'Get one',
              http: {
                method: 'GET',
                path: '/{id}',
                bind: { path: ['id'] },
              },
              input: Shape.object({ id: Field.string('ID') }),
              output: Shape.object({ id: Field.string('ID'), name: Field.string('Name') }),
            },
          },
        },
      },
    })
    const doc = JSON.parse(generate(normalizeProduct(product)))
    const op = doc.paths['/workers/scripts/{id}'].get
    expect(op.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string', description: 'ID' } },
    ])
  })

  test('query and header params project with their respective `in` values; headers carry const schemas', () => {
    const product = defineProduct({
      id: 'p',
      name: 'P',
      version: '0.1.0',
      auth: Auth.none(),
      resources: {
        thing: {
          label: 't',
          path: '/things',
          fields: { id: Field.string('ID').identifier() },
          operations: {
            list: {
              summary: 'List',
              http: {
                method: 'GET',
                path: '',
                bind: { query: ['cursor'], headers: { 'X-Api-Version': '2025-01-01' } },
              },
              input: Shape.object({ cursor: Field.string('Cursor').optional() }),
              output: Shape.list('thing'),
            },
          },
        },
      },
    })
    const doc = JSON.parse(generate(normalizeProduct(product)))
    const op = doc.paths['/things'].get
    expect(op.parameters).toEqual([
      { name: 'cursor', in: 'query', schema: { type: 'string', description: 'Cursor' } },
      {
        name: 'X-Api-Version',
        in: 'header',
        required: true,
        schema: { type: 'string', const: '2025-01-01' },
      },
    ])
  })

  test('body=true projects all non-path/query input fields under application/json', () => {
    const product = defineProduct({
      id: 'p',
      name: 'P',
      version: '0.1.0',
      auth: Auth.none(),
      resources: {
        thing: {
          label: 't',
          path: '/things',
          fields: { id: Field.string('ID').identifier() },
          operations: {
            create: {
              summary: 'Create',
              http: { method: 'POST', path: '', bind: { body: true } },
              input: Shape.object({
                name: Field.string('Name'),
                note: Field.string('Note').optional(),
              }),
              output: Shape.object({ id: Field.string('ID') }),
            },
          },
        },
      },
    })
    const doc = JSON.parse(generate(normalizeProduct(product)))
    const body = doc.paths['/things'].post.requestBody
    expect(body.required).toBe(true)
    expect(body.content['application/json'].schema.properties).toHaveProperty('name')
    expect(body.content['application/json'].schema.properties).toHaveProperty('note')
    expect(body.content['application/json'].schema.required).toEqual(['name'])
  })

  test('body=string[] picks an explicit subset and excludes the rest', () => {
    const product = defineProduct({
      id: 'p',
      name: 'P',
      version: '0.1.0',
      auth: Auth.none(),
      resources: {
        thing: {
          label: 't',
          path: '/things',
          fields: { id: Field.string('ID').identifier() },
          operations: {
            create: {
              summary: 'Create',
              http: { method: 'POST', path: '', bind: { body: ['name'] } },
              input: Shape.object({
                name: Field.string('Name'),
                note: Field.string('Note').optional(),
              }),
              output: Shape.object({ id: Field.string('ID') }),
            },
          },
        },
      },
    })
    const doc = JSON.parse(generate(normalizeProduct(product)))
    const props =
      doc.paths['/things'].post.requestBody.content['application/json'].schema.properties
    expect(Object.keys(props)).toEqual(['name'])
  })

  test('body=string[] does not duplicate fields already consumed by path or query bindings', () => {
    const product = defineProduct({
      id: 'p',
      name: 'P',
      version: '0.1.0',
      auth: Auth.none(),
      resources: {
        thing: {
          label: 't',
          path: '/things',
          fields: { id: Field.string('ID').identifier() },
          operations: {
            update: {
              summary: 'Update',
              http: {
                method: 'PATCH',
                path: '/{id}',
                bind: { path: ['id'], query: ['dry_run'], body: ['id', 'dry_run', 'name'] },
              },
              input: Shape.object({
                id: Field.string('ID'),
                dry_run: Field.boolean('Dry run').optional(),
                name: Field.string('Name'),
              }),
              output: Shape.object({ id: Field.string('ID') }),
            },
          },
        },
      },
    })
    const doc = JSON.parse(generate(normalizeProduct(product)))
    const props =
      doc.paths['/things/{id}'].patch.requestBody.content['application/json'].schema.properties
    expect(Object.keys(props)).toEqual(['name'])
  })
})

describe('generateOpenapi — responses', () => {
  test('every operation gets a default error response with {error: string}', () => {
    const doc = JSON.parse(generate(normalizeProduct(workersProduct)))
    const op = doc.paths['/workers/scripts'].get
    expect(op.responses.default.description).toBe('Unexpected error')
    expect(op.responses.default.content['application/json'].schema.required).toEqual(['error'])
  })
})
