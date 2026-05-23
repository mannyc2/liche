import { describe, expect, test } from 'bun:test'
import {
  ListToolsResultSchema,
  ToolSchema,
} from '@modelcontextprotocol/sdk/types.js'
import {
  Auth,
  Command,
  Field,
  Shape,
  canonicalDigest,
  defineProduct,
  generateMcpTools,
  normalizeProduct,
} from '../src/index.js'

function productWithAgentTool() {
  return defineProduct({
    id: 'acme',
    name: 'Acme',
    version: '1.0.0',
    auth: Auth.bearer({
      id: 'acme',
      sources: [Auth.token.env('ACME_TOKEN', { label: 'Bearer token' })],
    }),
    commands: {
      'deploy project': Command.remoteHttp({
        summary: 'Deploy a project',
        http: {
          method: 'POST',
          path: '/deployments',
          bind: { body: true },
        },
        input: Shape.object({ ref: Field.string('Git ref') }),
        output: Shape.object({ deployment_id: Field.string('Deployment ID') }),
        requires: { auth: true },
        surfaces: { agent: true },
      }),
    },
  })
}

function expectSchema(schema: { safeParse: (value: unknown) => { success: boolean; error?: unknown } }, value: unknown) {
  const result = schema.safeParse(value)
  expect(result.success, result.success ? undefined : String(result.error)).toBe(true)
}

describe('generated MCP tool conformance', () => {
  test('emits tools that validate as MCP Tool objects', () => {
    const catalog = normalizeProduct(productWithAgentTool())
    const manifest = JSON.parse(generateMcpTools(catalog, {
      canonicalCatalogDigest: canonicalDigest(catalog),
      generatorVersion: '0.0.0',
    }))

    expectSchema(ListToolsResultSchema, { tools: manifest.tools })
    expect(manifest.tools).toHaveLength(1)
    expectSchema(ToolSchema, manifest.tools[0])
    expect(manifest.tools[0].name).toBe('deploy_project')
    expect(manifest.tools[0].name).toMatch(/^[A-Za-z0-9_.\/-]{1,64}$/)
    expect(manifest.tools[0].inputSchema).toMatchObject({
      type: 'object',
      properties: { options: { type: 'object' } },
    })
    expect(manifest.tools[0].outputSchema).toMatchObject({
      type: 'object',
      properties: { deployment_id: { type: 'string' } },
    })
  })

  test('does not emit unsupported JSON Schema dialect markers', () => {
    const catalog = normalizeProduct(productWithAgentTool())
    const manifest = JSON.parse(generateMcpTools(catalog, {
      canonicalCatalogDigest: canonicalDigest(catalog),
      generatorVersion: '0.0.0',
    }))
    const tool = manifest.tools[0]

    for (const schema of [tool.inputSchema, tool.outputSchema]) {
      expect(
        schema.$schema === undefined || schema.$schema === 'https://json-schema.org/draft/2020-12/schema',
      ).toBe(true)
    }
  })
})
