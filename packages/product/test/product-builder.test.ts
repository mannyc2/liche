import { describe, expect, test } from 'bun:test'
import {
  Auth,
  Command,
  Config,
  Field,
  FieldBuilder,
  Product,
  ResourceBuilder,
  Runtime,
  Shape,
} from '../src/index.js'

describe('Field builder', () => {
  test('factory methods set the catalog type tag, not the constructor name', () => {
    expect(Field.string('x').toField().type).toBe('string')
    expect(Field.int('x').toField().type).toBe('int')
    expect(Field.boolean('x').toField().type).toBe('bool')
    expect(Field.uuid('x').toField().type).toBe('uuid')
    expect(Field.hostname('x').toField().type).toBe('hostname')
    expect(Field.datetime('x').toField().type).toBe('datetime')
    expect(Field.enum('x', ['a', 'b']).toField().type).toBe('enum')
  })

  test('fields default to required, mutable, public', () => {
    const f = Field.string('Script name').toField()
    expect(f.required).toBe(true)
    expect(f.mutability).toBe('mutable')
    expect(f.secret).toBe(false)
    expect(f.identifier).toBe(false)
    expect(f.humanLabel).toBe(false)
    expect('default' in f).toBe(false)
    expect('values' in f).toBe(false)
  })

  test('metadata flags compose without overriding earlier flags', () => {
    const f = Field.string('Script ID').identifier().immutable().toField()
    expect(f.identifier).toBe(true)
    expect(f.mutability).toBe('immutable')
    expect(f.required).toBe(true) // unchanged from default
  })

  test('optional() flips required off; required() flips it back on', () => {
    const f = Field.string('x').optional().required().toField()
    expect(f.required).toBe(true)
    const g = Field.string('x').required().optional().toField()
    expect(g.required).toBe(false)
  })

  test('createOnly is its own mutability bucket, distinct from immutable', () => {
    expect(Field.string('x').createOnly().toField().mutability).toBe('create-only')
    expect(Field.string('x').immutable().toField().mutability).toBe('immutable')
  })

  test('enum values flow through; values() can also be called explicitly', () => {
    const a = Field.enum('Tier', ['free', 'pro']).toField()
    expect(a.values).toEqual(['free', 'pro'])
    const b = Field.string('Region').values('us', 'eu').toField()
    expect(b.values).toEqual(['us', 'eu'])
  })

  test('default() records a falsy value distinct from omission', () => {
    const f = Field.boolean('Validate without publishing').optional().default(false).toField()
    expect(f.default).toBe(false)
    expect('default' in f).toBe(true)
  })

  test('fromConfig() records the explicit config path without changing requiredness', () => {
    const f = Field.string('Organization').optional().fromConfig('defaultOrg').toField()
    expect(f.configPath).toBe('defaultOrg')
    expect(f.required).toBe(false)
  })

  test('toField produces a plain record decoupled from the builder', () => {
    const builder = Field.string('Script name').humanLabel()
    const a = builder.toField()
    builder.secret()
    const b = builder.toField()
    expect(a.secret).toBe(false)
    expect(b.secret).toBe(true)
  })
})

describe('Shape factories', () => {
  test('Shape.object stores FieldBuilder instances under their authoring keys', () => {
    const shape = Shape.object({
      entrypoint: Field.string('Entrypoint file'),
      environment: Field.string('Environment').optional(),
    })
    expect(shape.kind).toBe('object')
    expect(shape.properties.entrypoint).toBeInstanceOf(FieldBuilder)
    expect(shape.properties.environment!.toField().required).toBe(false)
  })

  test('Shape.object copies the property bag (no shared mutation hazard)', () => {
    const props = { id: Field.string('Script ID').identifier() }
    const shape = Shape.object(props)
    delete (props as Record<string, unknown>).id
    expect(shape.properties.id).toBeInstanceOf(FieldBuilder)
  })

  test('Shape.list preserves the resource reference rather than inlining', () => {
    const shape = Shape.list('script')
    expect(shape).toEqual({ kind: 'list', resourceId: 'script' })
  })
})

describe('Command factories', () => {
  test('Command.workflow defaults to family=workflow and mode=hybrid-workflow', () => {
    const cmd = Command.workflow({
      summary: 'Deploy a Worker',
      input: Shape.object({ entrypoint: Field.string('Entrypoint file') }),
      output: Shape.object({ deployment_id: Field.string('Deployment ID') }),
      handler: 'wrangler.deploy',
    })
    expect(cmd.family).toBe('workflow')
    expect(cmd.execution.mode).toBe('hybrid-workflow')
    expect(cmd.execution).toEqual({ mode: 'hybrid-workflow', handler: 'wrangler.deploy' })
  })

  test('Command.workflow carries optional http and steps onto the execution record', () => {
    const cmd = Command.workflow({
      summary: 'Deploy',
      handler: 'wrangler.deploy',
      http: { method: 'POST', path: '/deploy' },
      steps: [{ id: 'bundle', label: 'Bundle local source', uses: 'local' }],
    })
    expect(cmd.execution).toEqual({
      mode: 'hybrid-workflow',
      handler: 'wrangler.deploy',
      http: { method: 'POST', path: '/deploy' },
      steps: [{ id: 'bundle', label: 'Bundle local source', uses: 'local' }],
    })
  })

  test('Command.local defaults to family=dev and mode=local', () => {
    const cmd = Command.local({
      summary: 'Run a local development server',
      handler: 'wrangler.dev',
      needs: ['filesystem', 'runtime'],
    })
    expect(cmd.family).toBe('dev')
    expect(cmd.execution).toEqual({
      mode: 'local',
      handler: 'wrangler.dev',
      needs: ['filesystem', 'runtime'],
    })
  })

  test('Command.remoteHttp requires an http spec and defaults to family=workflow', () => {
    const cmd = Command.remoteHttp({
      summary: 'Purge cache',
      http: { method: 'POST', path: '/zones/{zone}/purge_cache' },
    })
    expect(cmd.family).toBe('workflow')
    expect(cmd.execution).toEqual({
      mode: 'remote-http',
      http: { method: 'POST', path: '/zones/{zone}/purge_cache' },
    })
  })

  test('omitted command-shared fields are not added as undefined keys', () => {
    const cmd = Command.local({ summary: 'doctor', handler: 'doctor.run' })
    expect('description' in cmd).toBe(false)
    expect('permission' in cmd).toBe(false)
    expect('input' in cmd).toBe(false)
    expect('output' in cmd).toBe(false)
    expect('surfaces' in cmd).toBe(false)
  })
})

describe('Product builder', () => {
  test('Product.create returns a Product with kind="lili.product"', () => {
    const product = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' })
    expect(product.kind).toBe('lili.product')
    expect(product.id).toBe('workers')
    expect(product.name).toBe('Workers')
    expect(product.version).toBe('1.0.0')
    expect(product.resources).toEqual([])
    expect(product.commands).toEqual([])
    expect(product.bindings).toEqual([])
  })

  test('resource() registers a resource and invokes the builder callback', () => {
    const product = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' })
      .resource('script', { label: 'Worker script', path: '/workers/scripts' }, (r) =>
        r
          .field('id', Field.string('Script ID').identifier().immutable())
          .field('name', Field.string('Script name').humanLabel())
          .operation('list', {
            summary: 'List Worker scripts',
            http: { method: 'GET', path: '' },
            output: Shape.list('script'),
          }),
      )

    expect(product.resources).toHaveLength(1)
    const resource = product.resources[0]!
    expect(resource).toBeInstanceOf(ResourceBuilder)
    expect(resource.id).toBe('script')
    expect(resource.label).toBe('Worker script')
    expect(resource.path).toBe('/workers/scripts')
    expect(Object.keys(resource.fields)).toEqual(['id', 'name'])
    expect(resource.fields.id!.toField().identifier).toBe(true)
    expect(resource.operations).toHaveLength(1)
    expect(resource.operations[0]!.verb).toBe('list')
    expect(resource.operations[0]!.spec.output).toEqual({ kind: 'list', resourceId: 'script' })
  })

  test('command() and binding() chain alongside resources, preserving declaration order', () => {
    const product = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' })
      .command('deploy', Command.workflow({ summary: 'Deploy', handler: 'wrangler.deploy' }))
      .command('dev', Command.local({ summary: 'Dev server', handler: 'wrangler.dev' }))
      .binding({
        key: 'kv_namespaces',
        doc: 'KV namespaces bound to the Worker.',
        fields: Shape.object({
          binding: Field.string('Variable name in code'),
          id: Field.string('KV namespace id'),
        }),
      })

    expect(product.commands.map((c) => c.id)).toEqual(['deploy', 'dev'])
    expect(product.commands[0]!.spec.execution.mode).toBe('hybrid-workflow')
    expect(product.commands[1]!.spec.execution.mode).toBe('local')
    expect(product.bindings).toHaveLength(1)
    expect(product.bindings[0]!.key).toBe('kv_namespaces')
  })

  test('optional product init fields read as undefined when not provided', () => {
    const product = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' })
    expect(product.description).toBeUndefined()
    expect(product.scope).toBeUndefined()
  })

  test('scope and description flow through when provided', () => {
    const product = Product.create({
      id: 'workers',
      name: 'Workers',
      version: '1.0.0',
      description: 'Build and deploy serverless applications.',
      scope: { kind: 'account', param: 'account_id' },
    })
    expect(product.description).toBe('Build and deploy serverless applications.')
    expect(product.scope).toEqual({ kind: 'account', param: 'account_id' })
  })

  test('config() and remote() store product-level runtime declarations', () => {
    const config = Config.object({
      files: ['workers.jsonc'],
      fields: Shape.object({
        apiBaseUrl: Field.string('API base URL').default('https://api.example.test'),
      }),
      scopes: { project: { discoverUpwards: true }, user: false },
    })
    const remote = { baseUrl: Runtime.config('apiBaseUrl') }
    const product = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' })
      .config(config)
      .remote(remote)

    expect(product.configSpec).toBe(config)
    expect(product.remoteSpec).toBe(remote)
  })
})

describe('Auth authoring API', () => {
  test('Auth.none returns a plain { kind: "none" } spec', () => {
    expect(Auth.none()).toEqual({ kind: 'none' })
  })

  test('Auth.bearer captures id, optional header, and sources', () => {
    const spec = Auth.bearer({
      id: 'acme',
      sources: [Auth.token.env('ACME_TOKEN', { label: 'Bearer token' })],
    })
    expect(spec).toEqual({
      kind: 'bearer',
      id: 'acme',
      sources: [{ kind: 'env', envVar: 'ACME_TOKEN', label: 'Bearer token' }],
    })
  })

  test('Auth.bearer flows through a custom header when provided', () => {
    const spec = Auth.bearer({
      id: 'acme',
      header: 'X-Bearer',
      sources: [Auth.token.env('ACME_TOKEN')],
    })
    expect(spec.header).toBe('X-Bearer')
  })

  test('Auth.apiKey requires a header and stores sources', () => {
    const spec = Auth.apiKey({
      id: 'acme',
      header: 'x-api-key',
      sources: [Auth.token.env('ACME_API_KEY')],
    })
    expect(spec).toEqual({
      kind: 'apiKey',
      id: 'acme',
      header: 'x-api-key',
      sources: [{ kind: 'env', envVar: 'ACME_API_KEY' }],
    })
  })

  test('Auth.token.env supports mode: "ci"', () => {
    const src = Auth.token.env('ACME_CI_TOKEN', { mode: 'ci' })
    expect(src).toEqual({ kind: 'env', envVar: 'ACME_CI_TOKEN', mode: 'ci' })
  })

  test('Auth.token.env can carry known scopes for best-effort local scope checks', () => {
    const src = Auth.token.env('ACME_TOKEN', { scopes: ['cache.read'] })
    expect(src).toEqual({ kind: 'env', envVar: 'ACME_TOKEN', scopes: ['cache.read'] })
  })

  test('Auth.token.session enables file-backed profile storage', () => {
    expect(Auth.token.session({ profiles: true })).toEqual({ kind: 'session', profiles: true })
  })

  test('Auth.oauthDevice captures endpoints, identity, commands, and session sources', () => {
    const identity = Auth.identity({
      http: { method: 'GET', path: '/me' },
      subject: 'id',
      label: 'email',
    })
    const commands = Auth.commands({ login: 'login', logout: 'logout', switch: 'switch', whoami: 'whoami' })
    expect(Auth.oauthDevice({
      id: 'acme',
      token: { kind: 'bearer' },
      clientId: 'acme-cli',
      endpoints: {
        deviceAuthorization: 'https://auth.example.test/device',
        token: 'https://auth.example.test/token',
      },
      sources: [Auth.token.env('ACME_TOKEN'), Auth.token.session({ profiles: true })],
      identity,
      commands,
      scopes: ['cache.write'],
    })).toEqual({
      kind: 'oauthDevice',
      id: 'acme',
      token: { kind: 'bearer' },
      clientId: 'acme-cli',
      endpoints: {
        deviceAuthorization: 'https://auth.example.test/device',
        token: 'https://auth.example.test/token',
      },
      sources: [
        { kind: 'env', envVar: 'ACME_TOKEN' },
        { kind: 'session', profiles: true },
      ],
      identity,
      commands,
      scopes: ['cache.write'],
    })
  })

  test('Auth.permission.scope returns a product permission backed by an OAuth scope', () => {
    expect(Auth.permission.scope('workers.read')).toEqual({ kind: 'scope', scope: 'workers.read' })
  })

  test('Auth.context.env returns a kind:"env" spec with the select bag', () => {
    const ctx = Auth.context.env({
      label: 'Organization',
      select: { flag: 'org', env: 'ACME_ORG_ID' },
    })
    expect(ctx).toEqual({
      kind: 'env',
      label: 'Organization',
      select: { flag: 'org', env: 'ACME_ORG_ID' },
    })
  })

  test('Auth.context.remote keeps the list endpoint and id/name fields as metadata', () => {
    const ctx = Auth.context.remote({
      label: 'Organization',
      idField: 'org_id',
      nameField: 'name',
      list: { http: { method: 'GET', path: '/v1/orgs' } },
      select: { flag: 'org', env: 'ACME_ORG_ID' },
    })
    expect(ctx).toEqual({
      kind: 'remote',
      label: 'Organization',
      idField: 'org_id',
      nameField: 'name',
      list: { http: { method: 'GET', path: '/v1/orgs' } },
      select: { flag: 'org', env: 'ACME_ORG_ID' },
    })
  })

  test('Product.auth() stores the spec and rejects a second call', () => {
    const product = Product.create({ id: 'p', name: 'P', version: '1.0.0' }).auth(Auth.none())
    expect(product.authSpec).toEqual({ kind: 'none' })
    expect(() => product.auth(Auth.bearer({ id: 'x', sources: [Auth.token.env('Y')] }))).toThrow(/already declared auth/)
  })

  test('Product.context() preserves declaration order and rejects duplicate ids', () => {
    const product = Product.create({ id: 'p', name: 'P', version: '1.0.0' })
      .context('org', Auth.context.env({ select: { flag: 'org', env: 'ACME_ORG_ID' } }))
      .context('project', Auth.context.env({ select: { flag: 'project', env: 'ACME_PROJECT_ID' } }))
    expect(product.contexts.map((c) => c.id)).toEqual(['org', 'project'])
    expect(() =>
      product.context('org', Auth.context.env({ select: { flag: 'org', env: 'X' } })),
    ).toThrow(/already declared context/)
  })

  test('Product.permissions() stores product permissions and rejects duplicate ids', () => {
    const product = Product.create({ id: 'p', name: 'P', version: '1.0.0' }).permissions({
      read: Auth.permission.scope('read.scope'),
    })
    expect(product.permissionSpecs).toEqual({ read: { kind: 'scope', scope: 'read.scope' } })
    expect(() => product.permissions({ read: Auth.permission.scope('read.again') })).toThrow(/already declared permission/)
  })

  test('Product without .auth() leaves authSpec undefined (Commit 3 does not enforce)', () => {
    const product = Product.create({ id: 'p', name: 'P', version: '1.0.0' })
    expect(product.authSpec).toBeUndefined()
    expect(product.contexts).toEqual([])
    expect(product.permissionSpecs).toEqual({})
  })
})
