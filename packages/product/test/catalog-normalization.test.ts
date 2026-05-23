import { describe, expect, test } from 'bun:test'
import {
  Auth,
  Command,
  Config,
  Field,
  Runtime,
  Shape,
  buildAuthManifest,
  canonicalDigest,
  defineProduct,
  fieldToJsonSchema,
  normalizeProduct,
  resolveListShape,
} from '../src/index.js'
import type {
  CommandCapability,
  ProductDefinition,
  ResourceOperationCapability,
} from '../src/index.js'

type ProductOverrides = Omit<ProductDefinition, 'id' | 'name' | 'version'> &
  Partial<Pick<ProductDefinition, 'id' | 'name' | 'version'>>

function testProduct(init: ProductOverrides = {}) {
  return defineProduct({ id: 'p', name: 'P', version: '0.1.0', auth: Auth.none(), ...init })
}

function workersProduct() {
  return defineProduct({
    id: 'workers',
    name: 'Workers',
    version: '1.0.0',
    description: 'Build and deploy serverless applications.',
    scope: { kind: 'account', param: 'account_id' },
    auth: Auth.none(),
    permissions: {
      'workers:read': Auth.permission.scope('workers.read'),
      'workers:edit': Auth.permission.scope('workers.edit'),
    },
    resources: {
      script: {
        label: 'Worker script',
        path: '/workers/scripts',
        scope: 'account',
        fields: {
          id: Field.string('Script ID').identifier().immutable(),
          name: Field.string('Script name').humanLabel(),
          created_at: Field.datetime('Creation time').immutable().optional(),
        },
        operations: {
          list: {
            summary: 'List Worker scripts',
            effects: { kind: 'read', idempotent: true },
            policy: { conformanceEligible: true },
            examples: [{ command: 'workers script list --json' }],
            http: { method: 'GET', path: '' },
            output: Shape.list('script'),
            requires: { permissions: ['workers:read'] },
            surfaces: { cli: { command: 'workers script list' } },
          },
        },
      },
    },
    commands: {
      deploy: Command.workflow({
        summary: 'Deploy a Worker',
        effects: { kind: 'exec', idempotent: false },
        policy: { dangerous: true, requiresConfirmation: true, conformanceEligible: false },
        examples: [
          { command: 'workers deploy --entrypoint src/index.ts --environment preview --json' },
        ],
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
      dev: Command.local({
        summary: 'Run a local development server',
        input: Shape.object({ entrypoint: Field.string('Entrypoint file') }),
        handler: 'wrangler.dev',
        needs: ['filesystem', 'runtime'],
      }),
    },
    bindings: {
      kv_namespaces: {
        doc: 'KV namespaces bound to the Worker.',
        fields: Shape.object({
          binding: Field.string('Variable name in code'),
          id: Field.string('KV namespace id'),
        }),
      },
    },
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
      testProduct({ id: 'minimal', name: 'Minimal', version: '0.0.1' }),
    )
    expect('description' in catalog.product).toBe(false)
    expect('scope' in catalog.product).toBe(false)
  })
})

describe('Local ops normalization', () => {
  test('ops are off until the product opts into generated local support', () => {
    const catalog = normalizeProduct(testProduct())
    expect(catalog.ops).toEqual({
      enabled: false,
      doctor: false,
      telemetry: false,
      notices: { updates: [], channels: [], yanks: [] },
    })
  })

  test('ops opt-in normalizes doctor defaults, telemetry env vars, and static notices', () => {
    const catalog = normalizeProduct(
      testProduct({
        ops: {
          doctor: { packageManagers: ['bun', 'npm'] },
          telemetry: { enabledEnvVar: 'P_TELEMETRY', fileEnvVar: 'P_TELEMETRY_FILE' },
          notices: {
            updates: [{ id: 'p-1.1.0', message: 'P 1.1.0 is available.' }],
            channels: [{ id: 'p-next', message: 'Next channel available.' }],
            yanks: [{ id: 'p-0.9.0', severity: 'warning', message: 'P 0.9.0 is yanked.' }],
          },
        },
      }),
    )

    expect(catalog.ops).toEqual({
      enabled: true,
      doctor: { packageManagers: ['bun', 'npm'] },
      telemetry: { enabledEnvVar: 'P_TELEMETRY', fileEnvVar: 'P_TELEMETRY_FILE' },
      notices: {
        updates: [{ id: 'p-1.1.0', message: 'P 1.1.0 is available.' }],
        channels: [{ id: 'p-next', message: 'Next channel available.' }],
        yanks: [{ id: 'p-0.9.0', severity: 'warning', message: 'P 0.9.0 is yanked.' }],
      },
    })
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
    const cmd = normalizeProduct(
      testProduct({
        commands: {
          dev: Command.local({ summary: 'x', handler: 'h.run', needs: ['runtime', 'filesystem'] }),
        },
      }),
    ).capabilities[0] as CommandCapability
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
    const withHttp = testProduct({
      commands: {
        deploy: Command.workflow({
          summary: 'Deploy',
          handler: 'h.deploy',
          http: { method: 'POST', path: '/deploy' },
          surfaces: { openapi: true },
        }),
      },
    })
    const noHttp = testProduct({
      commands: {
        deploy: Command.workflow({
          summary: 'Deploy',
          handler: 'h.deploy',
          surfaces: { openapi: true },
        }),
      },
    })
    expect(normalizeProduct(withHttp).capabilities[0]!.surfaces.openapi).toBe(true)
    expect(normalizeProduct(noHttp).capabilities[0]!.surfaces.openapi).toBe(false)
  })

  test('remote-http command openapi is included by default; explicit false excludes', () => {
    const onByDefault = testProduct({
      commands: {
        purge: Command.remoteHttp({ summary: 'Purge', http: { method: 'POST', path: '/purge' } }),
      },
    })
    const offExplicit = testProduct({
      commands: {
        purge: Command.remoteHttp({
          summary: 'Purge',
          http: { method: 'POST', path: '/purge' },
          surfaces: { openapi: false },
        }),
      },
    })
    expect(normalizeProduct(onByDefault).capabilities[0]!.surfaces.openapi).toBe(true)
    expect(normalizeProduct(offExplicit).capabilities[0]!.surfaces.openapi).toBe(false)
  })

  test('resource HTTP op openapi flips off when surfaces.openapi=false', () => {
    expect(
      normalizeProduct(
        testProduct({
          resources: {
            script: {
              label: 'Script',
              path: '/scripts',
              operations: {
                list: {
                  summary: 'List scripts',
                  http: { method: 'GET', path: '' },
                  output: Shape.list('script'),
                  surfaces: { openapi: false },
                },
              },
            },
          },
        }),
      ).capabilities[0]!.surfaces.openapi,
    ).toBe(false)
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
    expect(() =>
      normalizeProduct(
        testProduct({
          bindings: [{ key: 'bad', fields: Shape.list('script') }],
        }),
      ),
    ).toThrow(/Binding 'bad' fields must be Shape\.object/)
  })
})

describe('Product config and remote runtime values', () => {
  test('config normalizes as a sibling of bindings with project/user scopes', () => {
    const catalog = normalizeProduct(
      testProduct({
        id: 'workers',
        name: 'Workers',
        version: '1.0.0',
        config: Config.object({
          files: ['workers.jsonc', 'workers.toml'],
          fields: Shape.object({
            apiBaseUrl: Field.string('API base URL').default('https://api.example.test'),
            defaultOrg: Field.string('Default org').optional(),
          }),
          scopes: { project: { discoverUpwards: true }, user: { xdg: true } },
        }),
        bindings: {
          kv_namespaces: {
            fields: Shape.object({ binding: Field.string('Binding'), id: Field.string('ID') }),
          },
        },
      }),
    )

    expect(catalog.config?.files).toEqual(['workers.jsonc', 'workers.toml'])
    expect(catalog.config?.scopes).toEqual({
      project: { discoverUpwards: true },
      user: { xdg: true },
    })
    expect(Object.keys(catalog.config!.fields.properties)).toEqual(['apiBaseUrl', 'defaultOrg'])
    expect(catalog.bindings.map((b) => b.key)).toEqual(['kv_namespaces'])
  })

  test('remote base URLs normalize from literal, env, and config sources', () => {
    const literal = normalizeProduct(
      testProduct({ remote: { baseUrl: Runtime.literal('https://api.example.test') } }),
    )
    expect(literal.remote).toEqual({
      baseUrl: { kind: 'literal', value: 'https://api.example.test' },
    })

    const env = normalizeProduct(
      testProduct({
        remote: {
          baseUrl: Runtime.env('P_API_URL', { fallback: 'https://fallback.example.test' }),
        },
      }),
    )
    expect(env.remote).toEqual({
      baseUrl: { kind: 'env', envVar: 'P_API_URL', fallback: 'https://fallback.example.test' },
    })

    const config = normalizeProduct(
      testProduct({
        config: Config.object({
          fields: Shape.object({ apiBaseUrl: Field.string('API base URL') }),
        }),
        remote: { baseUrl: Runtime.config('apiBaseUrl') },
      }),
    )
    expect(config.remote).toEqual({ baseUrl: { kind: 'config', path: 'apiBaseUrl' } })
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

  test('option config bindings project as x-lili-config-path', () => {
    const f = Field.string('Organization').optional().fromConfig('defaultOrg').toField()
    expect(fieldToJsonSchema(f)['x-lili-config-path']).toBe('defaultOrg')
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
    const catalog = normalizeProduct(
      testProduct({
        auth: Auth.bearer({
          id: 'acme',
          header: 'X-Bearer',
          sources: [
            Auth.token.env('ACME_TOKEN', { label: 'Bearer token' }),
            Auth.token.env('ACME_CI_TOKEN', { mode: 'ci' }),
          ],
        }),
      }),
    )
    expect(catalog.auth).toEqual({
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
    const catalog = normalizeProduct(
      testProduct({
        auth: Auth.apiKey({
          id: 'acme',
          header: 'x-api-key',
          sources: [Auth.token.env('ACME_API_KEY')],
        }),
      }),
    )
    expect(catalog.auth).toEqual({
      kind: 'apiKey',
      id: 'acme',
      header: 'x-api-key',
      tokenSources: [{ kind: 'env', envVar: 'ACME_API_KEY', mode: 'any' }],
    })
  })

  test('Auth.oauthDevice normalizes session source, identity, commands, and generated auth capabilities', () => {
    const catalog = normalizeProduct(
      testProduct({
        auth: Auth.oauthDevice({
          id: 'acme',
          token: { kind: 'bearer' },
          clientId: 'acme-cli',
          endpoints: {
            deviceAuthorization: 'https://auth.example.test/device',
            token: 'https://auth.example.test/token',
          },
          sources: [Auth.token.env('ACME_TOKEN'), Auth.token.session({ profiles: true })],
          identity: Auth.identity({
            http: { method: 'GET', path: '/me' },
            subject: 'id',
            label: 'email',
          }),
          commands: Auth.commands({
            login: 'login',
            logout: 'logout',
            switch: 'switch',
            whoami: 'whoami',
          }),
        }),
        contexts: {
          org: Auth.context.env({ select: { flag: 'org', env: 'ACME_ORG_ID' } }),
        },
      }),
    )
    expect(catalog.auth).toMatchObject({
      kind: 'oauthDevice',
      id: 'acme',
      tokenKind: 'bearer',
      tokenSources: [
        { kind: 'env', envVar: 'ACME_TOKEN', mode: 'any' },
        { kind: 'session', profiles: true, refresh: false },
      ],
      session: { enabled: true, profiles: true },
      commands: { login: 'login', logout: 'logout', switch: 'switch', whoami: 'whoami' },
      identity: {
        http: {
          method: 'GET',
          path: '/me',
          bind: { path: [], query: [], headers: {}, body: false },
        },
        subject: 'id',
        label: 'email',
      },
    })
    expect(
      catalog.capabilities
        .filter((cap) => cap.kind === 'command' && cap.family === 'auth')
        .map((cap) => cap.command[0]),
    ).toEqual(['whoami', 'switch', 'login', 'logout'])
  })

  test('product without an auth declaration normalizes to no auth', () => {
    expect(
      normalizeProduct(defineProduct({ id: 'leaky', name: 'L', version: '0.1.0' })).auth,
    ).toEqual({ kind: 'none' })
  })
})

describe('Permission normalization', () => {
  test('product permissions normalize as catalog nodes', () => {
    const catalog = normalizeProduct(workersProduct())
    expect(catalog.permissions).toEqual([
      { id: 'workers:edit', scope: 'workers.edit' },
      { id: 'workers:read', scope: 'workers.read' },
    ])
  })

  test('requires.permissions referencing an undeclared product permission throws', () => {
    const product = testProduct({
      commands: {
        deploy: Command.workflow({
          summary: 'Deploy',
          handler: 'h.deploy',
          requires: { permissions: ['workers:edit'] },
        }),
      },
    })
    expect(() => normalizeProduct(product)).toThrow(/requires undeclared permission 'workers:edit'/)
  })
})

describe('Context normalization', () => {
  test('Auth.context.env contexts preserve declaration order and surface { flag, env }', () => {
    const product = testProduct({
      contexts: {
        org: Auth.context.env({
          label: 'Organization',
          select: { flag: 'org', env: 'ACME_ORG_ID' },
        }),
        project: Auth.context.env({ select: { flag: 'project', env: 'ACME_PROJECT_ID' } }),
      },
    })

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
    const product = testProduct({
      contexts: {
        org: Auth.context.remote({
          label: 'Organization',
          idField: 'org_id',
          nameField: 'name',
          list: { http: { method: 'GET', path: '/v1/orgs' } },
          select: { flag: 'org', env: 'ACME_ORG_ID' },
        }),
      },
    })
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
    const productWithAuthRequirement = testProduct({
      commands: {
        deploy: Command.workflow({
          summary: 'Deploy',
          handler: 'h.deploy',
          requires: { auth: true },
        }),
      },
    })
    expect(() => normalizeProduct(productWithAuthRequirement)).toThrow(
      /requires auth but product declared Auth\.none/,
    )
  })

  test('requires.contexts referencing an undeclared context throws', () => {
    const productWithMissingContext = testProduct({
      commands: {
        deploy: Command.workflow({
          summary: 'Deploy',
          handler: 'h.deploy',
          requires: { contexts: ['org'] },
        }),
      },
    })
    expect(() => normalizeProduct(productWithMissingContext)).toThrow(/undeclared context 'org'/)
  })

  test('requires.contexts referencing a declared context is accepted', () => {
    const productWithContext = testProduct({
      permissions: { 'workers:edit': Auth.permission.scope('workers.edit') },
      contexts: {
        org: Auth.context.env({ select: { flag: 'org', env: 'ACME_ORG_ID' } }),
      },
      commands: {
        deploy: Command.workflow({
          summary: 'Deploy',
          handler: 'h.deploy',
          requires: { contexts: ['org'], permissions: ['workers:edit'] },
        }),
      },
    })
    const deploy = normalizeProduct(productWithContext).capabilities[0]!
    expect(deploy.requires).toEqual({
      auth: false,
      contexts: ['org'],
      permissions: ['workers:edit'],
    })
  })
})

describe('Digest sensitivity to auth and requires', () => {
  test('switching Auth.none() to Auth.bearer changes the catalog digest', () => {
    const noneProduct = testProduct()
    const bearerProduct = testProduct({
      auth: Auth.bearer({ id: 'p', sources: [Auth.token.env('P_TOKEN')] }),
    })
    expect(canonicalDigest(normalizeProduct(noneProduct))).not.toBe(
      canonicalDigest(normalizeProduct(bearerProduct)),
    )
  })

  test('adding a permission to a capability changes the catalog digest', () => {
    const a = testProduct({
      commands: { deploy: Command.workflow({ summary: 'd', handler: 'h.d' }) },
    })
    const b = testProduct({
      permissions: { w: Auth.permission.scope('w.scope') },
      commands: {
        deploy: Command.workflow({
          summary: 'd',
          handler: 'h.d',
          requires: { permissions: ['w'] },
        }),
      },
    })
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
    const auth = buildAuthManifest(
      normalizeProduct(
        testProduct({
          auth: Auth.bearer({
            id: 'acme',
            sources: [
              Auth.token.env('ACME_TOKEN'),
              Auth.token.env('ACME_CI_TOKEN', { mode: 'ci' }),
            ],
          }),
          contexts: {
            org: Auth.context.env({ select: { flag: 'org', env: 'ACME_ORG_ID' } }),
          },
        }),
      ),
    )
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

  test('OAuth device auth manifest records session storage and non-secret command metadata', () => {
    const provider = buildAuthManifest(
      normalizeProduct(
        testProduct({
          auth: Auth.oauthDevice({
            id: 'acme',
            token: { kind: 'bearer' },
            clientId: 'acme-cli',
            endpoints: {
              deviceAuthorization: 'https://auth.example.test/device',
              token: 'https://auth.example.test/token',
            },
            sources: [Auth.token.env('ACME_TOKEN'), Auth.token.session({ profiles: true })],
            commands: Auth.commands({
              login: 'login',
              logout: 'logout',
              switch: 'switch',
              whoami: 'whoami',
            }),
          }),
          contexts: {
            org: Auth.context.env({ select: { flag: 'org', env: 'ACME_ORG_ID' } }),
          },
        }),
      ),
    ).providers[0]
    expect(provider).toMatchObject({
      id: 'acme',
      kind: 'oauthDevice',
      credentialTransport: 'bearer',
      modes: ['env', 'session', 'oauth-device'],
      commands: { login: 'login', logout: 'logout', switch: 'switch', whoami: 'whoami' },
      envVars: [{ name: 'ACME_TOKEN', purpose: 'bearer-token', mode: 'any' }],
      sessionStorage: {
        used: true,
        profiles: true,
        storesAccessTokens: true,
        storesRefreshTokens: false,
        keychainRequired: false,
      },
      requiredRuntimeCapabilities: ['env', 'filesystem', 'tty-for-login'],
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
    const a = testProduct({
      commands: {
        deploy: Command.workflow({
          summary: 'Deploy',
          handler: 'h.deploy',
          input: Shape.object({
            entrypoint: Field.string('Entrypoint'),
            environment: Field.string('Environment').optional(),
          }),
        }),
      },
    })
    const b = testProduct({
      commands: {
        deploy: Command.workflow({
          summary: 'Deploy',
          handler: 'h.deploy',
          input: Shape.object({
            environment: Field.string('Environment').optional(),
            entrypoint: Field.string('Entrypoint'),
          }),
        }),
      },
    })
    expect(canonicalDigest(normalizeProduct(a))).toBe(canonicalDigest(normalizeProduct(b)))
  })

  test('digest changes when field metadata changes (e.g., adding .secret() to a field)', () => {
    const before = testProduct({
      resources: {
        script: {
          label: 'S',
          path: '/s',
          fields: { token: Field.string('API token') },
        },
      },
    })
    const after = testProduct({
      resources: {
        script: {
          label: 'S',
          path: '/s',
          fields: { token: Field.string('API token').secret() },
        },
      },
    })
    expect(canonicalDigest(normalizeProduct(before))).not.toBe(
      canonicalDigest(normalizeProduct(after)),
    )
  })

  test('digest is unchanged when product is rebuilt with the same shapes (no class-instance identity in IR)', () => {
    const build = () => {
      const reusedField = Field.string('Script name').humanLabel()
      return testProduct({
        resources: {
          script: {
            label: 'S',
            path: '/s',
            fields: { name: reusedField },
          },
        },
      })
    }
    expect(canonicalDigest(normalizeProduct(build()))).toBe(
      canonicalDigest(normalizeProduct(build())),
    )
  })
})
