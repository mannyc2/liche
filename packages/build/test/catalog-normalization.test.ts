import { describe, expect, test } from 'bun:test'
import {
  Auth,
  Command,
  Field,
  Product,
  Shape,
  buildAuthManifest,
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
    .auth(Auth.none())
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
            requires: { permissions: ['workers:read'] },
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
        requires: { permissions: ['workers:edit'] },
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
      Product.create({ id: 'minimal', name: 'Minimal', version: '0.0.1' }).auth(Auth.none()),
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
    const product = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).auth(Auth.none()).command(
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
    const withHttp = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).auth(Auth.none()).command(
      'deploy',
      Command.workflow({
        summary: 'Deploy',
        handler: 'h.deploy',
        http: { method: 'POST', path: '/deploy' },
        surfaces: { openapi: true },
      }),
    )
    const noHttp = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).auth(Auth.none()).command(
      'deploy',
      Command.workflow({ summary: 'Deploy', handler: 'h.deploy', surfaces: { openapi: true } }),
    )
    expect(normalizeProduct(withHttp).capabilities[0]!.surfaces.openapi).toBe(true)
    expect(normalizeProduct(noHttp).capabilities[0]!.surfaces.openapi).toBe(false)
  })

  test('remote-http command openapi is included by default; explicit false excludes', () => {
    const onByDefault = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).auth(Auth.none()).command(
      'purge',
      Command.remoteHttp({ summary: 'Purge', http: { method: 'POST', path: '/purge' } }),
    )
    const offExplicit = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).auth(Auth.none()).command(
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
    const product = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).auth(Auth.none()).resource(
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
    const product = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).auth(Auth.none()).binding({
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

describe('Auth normalization', () => {
  test('Auth.none() flows through as { kind: "none" } and produces an empty contexts list', () => {
    const catalog = normalizeProduct(workersProduct())
    expect(catalog.auth).toEqual({ kind: 'none' })
    expect(catalog.contexts).toEqual([])
  })

  test('Auth.bearer normalizes id, header, and token sources (default mode = "any")', () => {
    const product = Product.create({ id: 'p', name: 'P', version: '0.1.0' })
      .auth(
        Auth.bearer({
          id: 'acme',
          header: 'X-Bearer',
          sources: [
            Auth.token.env('ACME_TOKEN', { label: 'Bearer token' }),
            Auth.token.env('ACME_CI_TOKEN', { mode: 'ci' }),
          ],
        }),
      )
    expect(normalizeProduct(product).auth).toEqual({
      kind: 'bearer',
      id: 'acme',
      header: 'X-Bearer',
      tokenSources: [
        { kind: 'env', envVar: 'ACME_TOKEN', mode: 'any', label: 'Bearer token' },
        { kind: 'env', envVar: 'ACME_CI_TOKEN', mode: 'ci' },
      ],
    })
  })

  test('Auth.apiKey requires a header and normalizes its sources', () => {
    const product = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).auth(
      Auth.apiKey({ id: 'acme', header: 'x-api-key', sources: [Auth.token.env('ACME_API_KEY')] }),
    )
    expect(normalizeProduct(product).auth).toEqual({
      kind: 'apiKey',
      id: 'acme',
      header: 'x-api-key',
      tokenSources: [{ kind: 'env', envVar: 'ACME_API_KEY', mode: 'any' }],
    })
  })

  test('product without an auth declaration is rejected by normalizeProduct', () => {
    const product = Product.create({ id: 'leaky', name: 'L', version: '0.1.0' })
    expect(() => normalizeProduct(product)).toThrow(/Auth\.none/)
  })
})

describe('Context normalization', () => {
  test('Auth.context.env contexts preserve declaration order and surface { flag, env }', () => {
    const product = Product.create({ id: 'p', name: 'P', version: '0.1.0' })
      .auth(Auth.none())
      .context('org', Auth.context.env({ label: 'Organization', select: { flag: 'org', env: 'ACME_ORG_ID' } }))
      .context('project', Auth.context.env({ select: { flag: 'project', env: 'ACME_PROJECT_ID' } }))

    expect(normalizeProduct(product).contexts).toEqual([
      {
        id: 'org',
        source: 'env',
        label: 'Organization',
        select: { flag: 'org', env: 'ACME_ORG_ID' },
      },
      {
        id: 'project',
        source: 'env',
        select: { flag: 'project', env: 'ACME_PROJECT_ID' },
      },
    ])
  })

  test('Auth.context.remote preserves list endpoint and id/name fields as metadata', () => {
    const product = Product.create({ id: 'p', name: 'P', version: '0.1.0' })
      .auth(Auth.none())
      .context(
        'org',
        Auth.context.remote({
          label: 'Organization',
          idField: 'org_id',
          nameField: 'name',
          list: { http: { method: 'GET', path: '/v1/orgs' } },
          select: { flag: 'org', env: 'ACME_ORG_ID' },
        }),
      )
    const ctx = normalizeProduct(product).contexts[0]!
    expect(ctx.source).toBe('remote')
    expect(ctx.idField).toBe('org_id')
    expect(ctx.nameField).toBe('name')
    expect(ctx.list).toEqual({
      method: 'GET',
      path: '/v1/orgs',
      bind: { path: [], query: [], headers: {}, body: false },
    })
  })
})

describe('Capability requires', () => {
  test('legacy "permission" string has been replaced by structured requires.permissions[]', () => {
    const catalog = normalizeProduct(workersProduct())
    const list = catalog.capabilities.find((c) => c.id === 'script.list')!
    const deploy = catalog.capabilities.find((c) => c.id === 'deploy')!
    expect((list as { permission?: string }).permission).toBeUndefined()
    expect(list.requires).toEqual({ auth: false, contexts: [], permissions: ['workers:read'] })
    expect(deploy.requires).toEqual({ auth: false, contexts: [], permissions: ['workers:edit'] })
  })

  test('requires defaults to {auth:false, contexts:[], permissions:[]} when omitted', () => {
    const catalog = normalizeProduct(workersProduct())
    const dev = catalog.capabilities.find((c) => c.id === 'dev')!
    expect(dev.requires).toEqual({ auth: false, contexts: [], permissions: [] })
  })

  test('requires.auth=true on a capability when product has Auth.none() throws', () => {
    const product = Product.create({ id: 'p', name: 'P', version: '0.1.0' })
      .auth(Auth.none())
      .command(
        'deploy',
        Command.workflow({
          summary: 'Deploy',
          handler: 'h.deploy',
          requires: { auth: true },
        }),
      )
    expect(() => normalizeProduct(product)).toThrow(/requires auth but product declared Auth\.none/)
  })

  test('requires.contexts referencing an undeclared context throws', () => {
    const product = Product.create({ id: 'p', name: 'P', version: '0.1.0' })
      .auth(Auth.none())
      .command(
        'deploy',
        Command.workflow({
          summary: 'Deploy',
          handler: 'h.deploy',
          requires: { contexts: ['org'] },
        }),
      )
    expect(() => normalizeProduct(product)).toThrow(/undeclared context 'org'/)
  })

  test('requires.contexts referencing a declared context is accepted', () => {
    const product = Product.create({ id: 'p', name: 'P', version: '0.1.0' })
      .auth(Auth.none())
      .context('org', Auth.context.env({ select: { flag: 'org', env: 'ACME_ORG_ID' } }))
      .command(
        'deploy',
        Command.workflow({
          summary: 'Deploy',
          handler: 'h.deploy',
          requires: { contexts: ['org'], permissions: ['workers:edit'] },
        }),
      )
    const deploy = normalizeProduct(product).capabilities[0]!
    expect(deploy.requires).toEqual({ auth: false, contexts: ['org'], permissions: ['workers:edit'] })
  })
})

describe('Digest sensitivity to auth and requires', () => {
  test('switching Auth.none() to Auth.bearer changes the catalog digest', () => {
    const noneProduct = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).auth(Auth.none())
    const bearerProduct = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).auth(
      Auth.bearer({ id: 'p', sources: [Auth.token.env('P_TOKEN')] }),
    )
    expect(canonicalDigest(normalizeProduct(noneProduct))).not.toBe(
      canonicalDigest(normalizeProduct(bearerProduct)),
    )
  })

  test('adding a permission to a capability changes the catalog digest', () => {
    const a = Product.create({ id: 'p', name: 'P', version: '0.1.0' })
      .auth(Auth.none())
      .command('deploy', Command.workflow({ summary: 'd', handler: 'h.d' }))
    const b = Product.create({ id: 'p', name: 'P', version: '0.1.0' })
      .auth(Auth.none())
      .command(
        'deploy',
        Command.workflow({ summary: 'd', handler: 'h.d', requires: { permissions: ['w'] } }),
      )
    expect(canonicalDigest(normalizeProduct(a))).not.toBe(canonicalDigest(normalizeProduct(b)))
  })
})

describe('Surface manifest auth metadata', () => {
  test('Auth.none() yields a single "none" provider with no env vars or runtime capabilities', () => {
    const catalog = normalizeProduct(workersProduct())
    const auth = buildAuthManifest(catalog)
    expect(auth.providers).toHaveLength(1)
    const provider = auth.providers[0]!
    expect(provider.kind).toBe('none')
    expect(provider.modes).toEqual([])
    expect(provider.envVars).toEqual([])
    expect(provider.requiredRuntimeCapabilities).toEqual([])
  })

  test('Auth.bearer records env vars (with mode), credentialTransport, and contexts', () => {
    const product = Product.create({ id: 'p', name: 'P', version: '0.1.0' })
      .auth(
        Auth.bearer({
          id: 'acme',
          sources: [Auth.token.env('ACME_TOKEN'), Auth.token.env('ACME_CI_TOKEN', { mode: 'ci' })],
        }),
      )
      .context('org', Auth.context.env({ select: { flag: 'org', env: 'ACME_ORG_ID' } }))
    const auth = buildAuthManifest(normalizeProduct(product))
    expect(auth.providers[0]).toEqual({
      id: 'acme',
      kind: 'bearer',
      credentialTransport: 'bearer',
      modes: ['env'],
      envVars: [
        { name: 'ACME_TOKEN', purpose: 'bearer-token', mode: 'any' },
        { name: 'ACME_CI_TOKEN', purpose: 'bearer-token', mode: 'ci' },
      ],
      contexts: [{ id: 'org', source: 'env', flag: 'org', envVar: 'ACME_ORG_ID' }],
      requiredRuntimeCapabilities: ['env'],
    })
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
    const a = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).auth(Auth.none()).command(
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
    const b = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).auth(Auth.none()).command(
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
    const before = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).auth(Auth.none()).resource(
      'script',
      { label: 'S', path: '/s' },
      (r) => r.field('token', Field.string('API token')),
    )
    const after = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).auth(Auth.none()).resource(
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
      return Product.create({ id: 'p', name: 'P', version: '0.1.0' }).auth(Auth.none()).resource(
        'script',
        { label: 'S', path: '/s' },
        (r) => r.field('name', reusedField),
      )
    }
    expect(canonicalDigest(normalizeProduct(build()))).toBe(canonicalDigest(normalizeProduct(build())))
  })
})
