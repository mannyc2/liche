import { describe, expect, test } from 'bun:test'
import {
  Command,
  Field,
  Product,
  Shape,
  canonicalDigest,
  fieldToJsonSchema,
  normalizeProduct,
  resolveListShape,
} from '../src/index.js'
import type { CommandCapability, ResourceOperationCapability } from '../src/index.js'

function workersProduct() {
  return Product.create({
    id: 'workers',
    name: 'Workers',
    version: '1.0.0',
    description: 'Build and deploy serverless applications.',
    scope: { kind: 'account', param: 'account_id' },
  })
    .resource(
      'script',
      { label: 'Worker script', path: '/workers/scripts', scope: 'account' },
      (resource) =>
        resource
          .field('id', Field.string('Script ID').identifier().immutable())
          .field('name', Field.string('Script name').humanLabel())
          .field('created_at', Field.datetime('Creation time').immutable().optional())
          .operation('list', {
            summary: 'List Worker scripts',
            http: { method: 'GET', path: '' },
            output: Shape.list('script'),
            permission: 'workers:read',
            surfaces: { cli: { command: 'workers script list' } },
          }),
    )
    .command(
      'deploy',
      Command.workflow({
        summary: 'Deploy a Worker',
        input: Shape.object({
          entrypoint: Field.string('Entrypoint file'),
          environment: Field.string('Environment').optional(),
          dry_run: Field.boolean('Validate without publishing').optional(),
        }),
        output: Shape.object({
          deployment_id: Field.string('Deployment ID'),
          url: Field.string('Deployment URL').optional(),
        }),
        handler: 'wrangler.deploy',
        steps: [
          { id: 'bundle', label: 'Bundle local source', uses: 'local' },
          { id: 'upload', label: 'Upload assets', uses: 'api' },
        ],
        permission: 'workers:edit',
        surfaces: { agent: true, dashboard: { view: 'action', placement: 'page' } },
      }),
    )
    .command(
      'dev',
      Command.local({
        summary: 'Run a local development server',
        input: Shape.object({ entrypoint: Field.string('Entrypoint file') }),
        handler: 'wrangler.dev',
        needs: ['filesystem', 'runtime'],
      }),
    )
    .binding({
      key: 'kv_namespaces',
      doc: 'KV namespaces bound to the Worker.',
      fields: Shape.object({
        binding: Field.string('Variable name in code'),
        id: Field.string('KV namespace id'),
      }),
    })
}

describe('Catalog header', () => {
  test('carries product id/name/version/description/scope and the catalog version tag', () => {
    const catalog = normalizeProduct(workersProduct())
    expect(catalog.kind).toBe('lili.catalog')
    expect(catalog.catalogVersion).toBe(1)
    expect(catalog.product).toEqual({
      id: 'workers',
      name: 'Workers',
      version: '1.0.0',
      description: 'Build and deploy serverless applications.',
      scope: { kind: 'account', param: 'account_id' },
    })
  })

  test('omits undeclared product fields rather than emitting undefined', () => {
    const catalog = normalizeProduct(
      Product.create({ id: 'minimal', name: 'Minimal', version: '0.0.1' }),
    )
    expect('description' in catalog.product).toBe(false)
    expect('scope' in catalog.product).toBe(false)
  })
})

describe('Resource normalization', () => {
  test('normalizes resource fields into a plain NormalizedField record', () => {
    const catalog = normalizeProduct(workersProduct())
    const script = catalog.resources.find((r) => r.id === 'script')!
    expect(script.label).toBe('Worker script')
    expect(script.path).toBe('/workers/scripts')
    expect(script.scope).toBe('account')
    expect(Object.keys(script.fields)).toEqual(['id', 'name', 'created_at'])
    expect(script.fields.id).toEqual({
      type: 'string',
      description: 'Script ID',
      required: true,
      secret: false,
      identifier: true,
      humanLabel: false,
      mutability: 'immutable',
    })
    expect(script.fields.created_at!.required).toBe(false)
  })
})

describe('Capability flattening', () => {
  test('resource operations and commands appear in one capabilities array with distinct kinds', () => {
    const catalog = normalizeProduct(workersProduct())
    const kinds = catalog.capabilities.map((c) => c.kind)
    expect(kinds).toEqual(['resource-operation', 'command', 'command'])
    expect(catalog.capabilities.map((c) => c.id)).toEqual(['script.list', 'deploy', 'dev'])
  })

  test('resource operations carry the [resourceId, verb] command path and an http spec when declared', () => {
    const catalog = normalizeProduct(workersProduct())
    const op = catalog.capabilities[0] as ResourceOperationCapability
    expect(op.kind).toBe('resource-operation')
    expect(op.resourceId).toBe('script')
    expect(op.verb).toBe('list')
    expect(op.command).toEqual(['script', 'list'])
    expect(op.http).toEqual({
      method: 'GET',
      path: '',
      bind: { path: [], query: [], headers: {}, body: false },
    })
  })

  test('list output stays as a reference; the resource fields are not inlined', () => {
    const catalog = normalizeProduct(workersProduct())
    const op = catalog.capabilities[0] as ResourceOperationCapability
    expect(op.output).toEqual({ kind: 'list', resourceId: 'script' })
  })

  test('command capabilities carry execution mode, sorted needs, and steps in declaration order', () => {
    const catalog = normalizeProduct(workersProduct())
    const deploy = catalog.capabilities.find((c) => c.id === 'deploy') as CommandCapability
    const dev = catalog.capabilities.find((c) => c.id === 'dev') as CommandCapability

    expect(deploy.execution).toEqual({
      mode: 'hybrid-workflow',
      handler: 'wrangler.deploy',
      steps: [
        { id: 'bundle', label: 'Bundle local source', uses: 'local' },
        { id: 'upload', label: 'Upload assets', uses: 'api' },
      ],
    })

    expect(dev.execution).toEqual({
      mode: 'local',
      handler: 'wrangler.dev',
      needs: ['filesystem', 'runtime'],
    })
  })

  test('local command `needs` is normalized to a sorted array even if authored unsorted', () => {
    const product = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).command(
      'dev',
      Command.local({ summary: 'x', handler: 'h.run', needs: ['runtime', 'filesystem'] }),
    )
    const cmd = normalizeProduct(product).capabilities[0] as CommandCapability
    expect(cmd.execution).toEqual({
      mode: 'local',
      handler: 'h.run',
      needs: ['filesystem', 'runtime'],
    })
  })
})

describe('Surface defaults', () => {
  test('cli defaults to included; cli.command override is preserved', () => {
    const catalog = normalizeProduct(workersProduct())
    const op = catalog.capabilities.find((c) => c.id === 'script.list')!
    expect(op.surfaces.cli).toBe(true)
    expect(op.surfaces.cliCommand).toBe('workers script list')
  })

  test('docs defaults to included; agent defaults to excluded; dashboard defaults to excluded', () => {
    const catalog = normalizeProduct(workersProduct())
    const dev = catalog.capabilities.find((c) => c.id === 'dev')!
    expect(dev.surfaces.docs).toBe(true)
    expect(dev.surfaces.agent).toBe(false)
    expect(dev.surfaces.dashboard).toBe(false)
  })

  test('agent and dashboard opt-ins flow through with metadata', () => {
    const catalog = normalizeProduct(workersProduct())
    const deploy = catalog.capabilities.find((c) => c.id === 'deploy')!
    expect(deploy.surfaces.agent).toBe(true)
    expect(deploy.surfaces.dashboard).toBe(true)
    expect(deploy.surfaces.dashboardView).toBe('action')
    expect(deploy.surfaces.dashboardPlacement).toBe('page')
  })

  test('openapi: resource HTTP op is included; local command excluded; hybrid-workflow excluded by default', () => {
    const catalog = normalizeProduct(workersProduct())
    const list = catalog.capabilities.find((c) => c.id === 'script.list')!
    const deploy = catalog.capabilities.find((c) => c.id === 'deploy')!
    const dev = catalog.capabilities.find((c) => c.id === 'dev')!
    expect(list.surfaces.openapi).toBe(true)
    expect(deploy.surfaces.openapi).toBe(false)
    expect(dev.surfaces.openapi).toBe(false)
  })

  test('hybrid-workflow openapi flips on only when explicitly true AND http exists', () => {
    const withHttp = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).command(
      'deploy',
      Command.workflow({
        summary: 'Deploy',
        handler: 'h.deploy',
        http: { method: 'POST', path: '/deploy' },
        surfaces: { openapi: true },
      }),
    )
    const noHttp = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).command(
      'deploy',
      Command.workflow({ summary: 'Deploy', handler: 'h.deploy', surfaces: { openapi: true } }),
    )
    expect(normalizeProduct(withHttp).capabilities[0]!.surfaces.openapi).toBe(true)
    expect(normalizeProduct(noHttp).capabilities[0]!.surfaces.openapi).toBe(false)
  })

  test('remote-http command openapi is included by default; explicit false excludes', () => {
    const onByDefault = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).command(
      'purge',
      Command.remoteHttp({ summary: 'Purge', http: { method: 'POST', path: '/purge' } }),
    )
    const offExplicit = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).command(
      'purge',
      Command.remoteHttp({
        summary: 'Purge',
        http: { method: 'POST', path: '/purge' },
        surfaces: { openapi: false },
      }),
    )
    expect(normalizeProduct(onByDefault).capabilities[0]!.surfaces.openapi).toBe(true)
    expect(normalizeProduct(offExplicit).capabilities[0]!.surfaces.openapi).toBe(false)
  })

  test('resource HTTP op openapi flips off when surfaces.openapi=false', () => {
    const product = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).resource(
      'script',
      { label: 'Script', path: '/scripts' },
      (r) =>
        r.operation('list', {
          summary: 'List scripts',
          http: { method: 'GET', path: '' },
          output: Shape.list('script'),
          surfaces: { openapi: false },
        }),
    )
    expect(normalizeProduct(product).capabilities[0]!.surfaces.openapi).toBe(false)
  })
})

describe('Bindings', () => {
  test('binding fields are normalized as an object shape with a jsonSchema snapshot', () => {
    const catalog = normalizeProduct(workersProduct())
    expect(catalog.bindings).toHaveLength(1)
    const kv = catalog.bindings[0]!
    expect(kv.key).toBe('kv_namespaces')
    expect(kv.doc).toBe('KV namespaces bound to the Worker.')
    expect(kv.fields.kind).toBe('object')
    expect(Object.keys(kv.fields.properties)).toEqual(['binding', 'id'])
    expect(kv.fields.jsonSchema.type).toBe('object')
    expect(kv.fields.jsonSchema.required).toEqual(['binding', 'id'])
  })

  test('Shape.list as binding fields is rejected', () => {
    const product = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).binding({
      key: 'bad',
      fields: Shape.list('script'),
    })
    expect(() => normalizeProduct(product)).toThrow(/Binding 'bad' fields must be Shape\.object/)
  })
})

describe('JSON Schema projection', () => {
  test('field metadata projects into description, format, and x-lili-* extensions', () => {
    const idSchema = fieldToJsonSchema({
      type: 'string',
      description: 'Script ID',
      required: true,
      secret: false,
      identifier: true,
      humanLabel: false,
      mutability: 'immutable',
    })
    expect(idSchema).toEqual({
      type: 'string',
      description: 'Script ID',
      'x-lili-identifier': true,
      'x-lili-mutability': 'immutable',
    })
  })

  test('secret and human-label flags project as their x-lili-* extensions', () => {
    const f = fieldToJsonSchema({
      type: 'string',
      description: 'API token',
      required: true,
      secret: true,
      identifier: false,
      humanLabel: true,
      mutability: 'mutable',
    })
    expect(f['x-lili-secret']).toBe(true)
    expect(f['x-lili-human-label']).toBe(true)
    expect('x-lili-mutability' in f).toBe(false)
  })

  test('enum and datetime types project type+format/enum lists', () => {
    expect(
      fieldToJsonSchema({
        type: 'datetime',
        description: 'Created at',
        required: false,
        secret: false,
        identifier: false,
        humanLabel: false,
        mutability: 'immutable',
      }),
    ).toMatchObject({ type: 'string', format: 'date-time' })

    expect(
      fieldToJsonSchema({
        type: 'enum',
        description: 'Tier',
        values: ['free', 'pro'],
        required: true,
        secret: false,
        identifier: false,
        humanLabel: false,
        mutability: 'mutable',
      }),
    ).toEqual({ type: 'string', description: 'Tier', enum: ['free', 'pro'] })
  })

  test('object shape jsonSchema sorts required and preserves property declaration order', () => {
    const catalog = normalizeProduct(workersProduct())
    const deploy = catalog.capabilities.find((c) => c.id === 'deploy') as CommandCapability
    const input = deploy.input!
    if (input.kind !== 'object') throw new Error('expected object input shape')
    expect(Object.keys(input.properties)).toEqual(['entrypoint', 'environment', 'dry_run'])
    expect(input.jsonSchema.required).toEqual(['entrypoint'])
  })
})

describe('resolveListShape', () => {
  test('returns an array JSON Schema with the referenced resource fields as items', () => {
    const catalog = normalizeProduct(workersProduct())
    const result = resolveListShape(catalog, { kind: 'list', resourceId: 'script' })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.resource.id).toBe('script')
    expect(result.jsonSchema.type).toBe('array')
    expect(result.jsonSchema.items?.type).toBe('object')
    expect(Object.keys(result.jsonSchema.items?.properties ?? {})).toEqual([
      'id',
      'name',
      'created_at',
    ])
  })

  test('reports broken resource references rather than throwing or inlining undefined', () => {
    const catalog = normalizeProduct(workersProduct())
    const result = resolveListShape(catalog, { kind: 'list', resourceId: 'ghost' })
    expect(result).toEqual({ ok: false, resourceId: 'ghost' })
  })
})

describe('Catalog digest stability', () => {
  test('canonical digest is identical across two structurally equivalent product builds', () => {
    const a = canonicalDigest(normalizeProduct(workersProduct()))
    const b = canonicalDigest(normalizeProduct(workersProduct()))
    expect(a).toBe(b)
  })

  test('canonical digest is insensitive to field declaration order WITHIN a shape (object keys are sorted)', () => {
    // canonicalDigest sorts object keys at every level. Property order within
    // Shape.object should not change the digest, but capability declaration
    // order WILL (arrays preserve order, intentionally).
    const a = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).command(
      'deploy',
      Command.workflow({
        summary: 'Deploy',
        handler: 'h.deploy',
        input: Shape.object({
          entrypoint: Field.string('Entrypoint'),
          environment: Field.string('Environment').optional(),
        }),
      }),
    )
    const b = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).command(
      'deploy',
      Command.workflow({
        summary: 'Deploy',
        handler: 'h.deploy',
        input: Shape.object({
          environment: Field.string('Environment').optional(),
          entrypoint: Field.string('Entrypoint'),
        }),
      }),
    )
    expect(canonicalDigest(normalizeProduct(a))).toBe(canonicalDigest(normalizeProduct(b)))
  })

  test('digest changes when field metadata changes (e.g., adding .secret() to a field)', () => {
    const before = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).resource(
      'script',
      { label: 'S', path: '/s' },
      (r) => r.field('token', Field.string('API token')),
    )
    const after = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).resource(
      'script',
      { label: 'S', path: '/s' },
      (r) => r.field('token', Field.string('API token').secret()),
    )
    expect(canonicalDigest(normalizeProduct(before))).not.toBe(
      canonicalDigest(normalizeProduct(after)),
    )
  })

  test('digest is unchanged when product is rebuilt with the same shapes (no class-instance identity in IR)', () => {
    const build = () => {
      const reusedField = Field.string('Script name').humanLabel()
      return Product.create({ id: 'p', name: 'P', version: '0.1.0' }).resource(
        'script',
        { label: 'S', path: '/s' },
        (r) => r.field('name', reusedField),
      )
    }
    expect(canonicalDigest(normalizeProduct(build()))).toBe(canonicalDigest(normalizeProduct(build())))
  })
})
