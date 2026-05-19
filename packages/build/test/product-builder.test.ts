import { describe, expect, test } from 'bun:test'
import {
  Command,
  Field,
  FieldBuilder,
  Product,
  ResourceBuilder,
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
})
