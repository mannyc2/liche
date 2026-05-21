import { describe, expect, test } from 'bun:test'
import {
  Auth,
  Command,
  Config,
  Field,
  Product,
  Shape,
  canonicalDigest,
  generateAgentReference,
  generateCommandManifest,
  generateConfigSchema,
  generateDocsReference,
  generateMcpTools,
  normalizeProduct,
  shouldGenerateConfigSchema,
} from '../src/index.js'
import workersProduct from './fixtures/workers.product.js'

function agentProduct() {
  return Product.create({
    id: 'acme',
    name: 'Acme',
    version: '1.0.0',
    description: 'Acme operations.',
  })
    .auth(Auth.bearer({
      id: 'acme',
      sources: [
        Auth.token.env('ACME_TOKEN', {
          label: 'Bearer token',
          scopes: ['deployments.write'],
        }),
      ],
    }))
    .permissions({
      'deployments:write': Auth.permission.scope('deployments.write'),
    })
    .context('org', Auth.context.env({
      label: 'Organization',
      select: { flag: 'org', env: 'ACME_ORG_ID' },
    }))
    .command(
      'deploy',
      Command.remoteHttp({
        summary: 'Deploy a project',
        effects: { kind: 'write', idempotent: false },
        policy: { dangerous: true, requiresConfirmation: true, conformanceEligible: true },
        examples: [{ command: 'acme deploy --org acme --ref main --json' }],
        http: {
          method: 'POST',
          path: '/orgs/{org_id}/deployments',
          bind: { path: ['org_id'], body: true },
        },
        input: Shape.object({
          ref: Field.string('Git ref'),
        }),
        output: Shape.object({
          deployment_id: Field.string('Deployment ID'),
        }),
        requires: {
          auth: true,
          contexts: ['org'],
          permissions: ['deployments:write'],
        },
        surfaces: { agent: true },
      }),
    )
    .command(
      'dev',
      Command.local({
        summary: 'Start dev server',
        input: Shape.object({ port: Field.int('Port').optional() }),
        handler: 'dev.run',
      }),
    )
}

function options(catalog: ReturnType<typeof normalizeProduct>) {
  return {
    generatorVersion: '0.0.0',
    canonicalCatalogDigest: canonicalDigest(catalog),
  }
}

describe('generated command manifest', () => {
  test('is catalog-derived and includes command schemas, execution, and auth metadata', () => {
    const catalog = normalizeProduct(agentProduct())
    const manifest = JSON.parse(generateCommandManifest(catalog, options(catalog)))
    const deploy = manifest.commands.find((command: any) => command.id === 'deploy')

    expect(manifest.manifestVersion).toBe('lili.command-manifest.v1')
    expect(manifest.product).toMatchObject({ id: 'acme', version: '1.0.0' })
    expect(deploy).toMatchObject({
      kind: 'command',
      command: 'deploy',
      execution: {
        mode: 'remote-http',
        http: { method: 'POST', path: '/orgs/{org_id}/deployments' },
      },
      effects: { kind: 'write', idempotent: false },
      policy: { dangerous: true, requiresConfirmation: true, conformanceEligible: true },
      examples: [{ command: 'acme deploy --org acme --ref main --json' }],
      requires: {
        auth: true,
        contexts: ['org'],
        permissions: ['deployments:write'],
      },
      auth: {
        required: true,
        providerId: 'acme',
        envVars: ['ACME_TOKEN'],
        requiredScopes: ['deployments.write'],
      },
    })
    expect(deploy.schemas.input.properties.ref.description).toBe('Git ref')
    expect(deploy.schemas.input.properties.org.description).toBe('Organization')
    expect(deploy.schemas.env.properties).toEqual({
      ACME_ORG_ID: { type: 'string' },
      ACME_TOKEN: { type: 'string' },
    })
    expect(deploy.schemas.output.properties.deployment_id.description).toBe('Deployment ID')
  })
})

describe('generated MCP tools', () => {
  test('includes only CLI commands explicitly marked agent-visible', () => {
    const catalog = normalizeProduct(agentProduct())
    const manifest = JSON.parse(generateMcpTools(catalog, options(catalog)))

    expect(manifest.manifestVersion).toBe('lili.mcp-tools.v1')
    expect(manifest.tools.map((tool: any) => tool.name)).toEqual(['deploy'])
    const tool = manifest.tools[0]
    expect(tool.inputSchema.properties.options.properties).toHaveProperty('ref')
    expect(tool.inputSchema.properties.options.properties).toHaveProperty('org')
    expect(tool.outputSchema.properties.deployment_id.description).toBe('Deployment ID')
    expect(tool.auth.envVars).toEqual(['ACME_TOKEN'])
    expect(tool.annotations).toMatchObject({
      capabilityId: 'deploy',
      command: 'deploy',
      execution: { mode: 'remote-http' },
      effects: { kind: 'write', idempotent: false },
      policy: { dangerous: true, requiresConfirmation: true, conformanceEligible: true },
      examples: [{ command: 'acme deploy --org acme --ref main --json' }],
    })
  })
})

describe('generated agent and docs references', () => {
  test('agent reference documents only agent-visible commands and noninteractive auth posture', () => {
    const catalog = normalizeProduct(agentProduct())
    const reference = generateAgentReference(catalog, options(catalog))

    expect(reference).toContain('# Acme agent reference')
    expect(reference).toContain('Do not start interactive auth flows')
    expect(reference).toContain('### deploy')
    expect(reference).toContain('`ACME_TOKEN`')
    expect(reference).toContain('`acme deploy --org acme --ref main --json`')
    expect(reference).not.toContain('### dev')
  })

  test('docs reference documents CLI commands and binding fields', () => {
    const catalog = normalizeProduct(workersProduct)
    const reference = generateDocsReference(catalog, options(catalog))

    expect(reference).toContain('# Workers CLI reference')
    expect(reference).toContain('### script list')
    expect(reference).toContain('`workers script list --json`')
    expect(reference).toContain('### deploy')
    expect(reference).toContain('### dev')
    expect(reference).toContain('## Config bindings')
    expect(reference).toContain('### kv_namespaces')
    expect(reference).toContain('| `binding` | Variable name in code |')
  })
})

describe('generated config schema', () => {
  test('is emitted when config or bindings exist and preserves both field groups', () => {
    const catalog = normalizeProduct(workersProduct)
    expect(shouldGenerateConfigSchema(catalog)).toBe(true)

    const schema = JSON.parse(generateConfigSchema(catalog, options(catalog)))
    expect(schema['x-lili-manifest-version']).toBe('lili.config-schema.v1')
    expect(schema.properties.apiBaseUrl.description).toBe('API base URL')
    expect(schema.properties.accountId.description).toBe('Default account ID')
    expect(schema.properties.kv_namespaces.type).toBe('array')
    expect(schema.properties.kv_namespaces.items.properties.binding.description).toBe('Variable name in code')
    expect(schema.properties.kv_namespaces.items.properties.id.description).toBe('KV namespace id')

    const configOnly = normalizeProduct(
      Product.create({ id: 'cfg', name: 'Cfg', version: '1.0.0' })
        .auth(Auth.none())
        .config(Config.object({
          fields: Shape.object({ apiBaseUrl: Field.string('API base URL') }),
        })),
    )
    expect(shouldGenerateConfigSchema(configOnly)).toBe(true)

    const noBindings = normalizeProduct(Product.create({ id: 'p', name: 'P', version: '1.0.0' }).auth(Auth.none()))
    expect(shouldGenerateConfigSchema(noBindings)).toBe(false)
  })
})
