import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  Contract,
  DEFAULT_GENERATED_VOCABULARY,
  normalizeContract,
  vocabulary,
} from '../src/index.js'

function projectsGet() {
  return {
    id: 'projects.get',
    command: ['projects', 'get'],
    locality: { modes: ['local', 'remote'], default: 'local' },
    input: z.object({ projectId: z.string() }),
    output: z.object({ project: z.object({ id: z.string(), name: z.string() }) }),
    effects: { kind: 'read' },
    local: { module: './impl/projects.ts', export: 'getProject' },
  } as const
}

describe('normalizeContract — base shape', () => {
  test('emits ContractIR with default vocabulary baked in', () => {
    const contract = Contract.create({
      name: 'acme',
      version: '0.1.0',
    }).operation(projectsGet())
    const ir = normalizeContract(contract)

    expect(ir.kind).toBe('lili.contract')
    expect(ir.irVersion).toBe(1)
    expect(ir.name).toBe('acme')
    expect(ir.version).toBe('0.1.0')
    expect(ir.vocabulary.verbs).toEqual([...DEFAULT_GENERATED_VOCABULARY.verbs])
    expect(ir.operations).toHaveLength(1)
  })

  test('per-contract vocabulary extensions merge with defaults', () => {
    const contract = Contract.create({
      name: 'acme',
      version: '0.1.0',
      vocabulary: vocabulary({ verbs: ['deploy'], flags: ['dry-run'] }),
    }).operation(projectsGet())
    const ir = normalizeContract(contract)
    expect(ir.vocabulary.verbs).toContain('deploy')
    expect(ir.vocabulary.verbs).toContain('get')
    expect(ir.vocabulary.flags).toContain('dry-run')
    expect(ir.vocabulary.flags).toContain('json')
  })

  test('explicit vocabulary can replace defaults', () => {
    const contract = Contract.create({
      name: 'builder',
      version: '0.1.0',
      vocabulary: { aliases: {}, flags: ['json', 'out'], verbs: ['generate'] },
    }).operation(projectsGet())
    const ir = normalizeContract(contract)
    expect(ir.vocabulary.verbs).toEqual(['generate'])
    expect(ir.vocabulary.flags).toEqual(['json', 'out'])
  })
})

describe('normalizeContract — operation IR', () => {
  test('derives policy from effects when policy is unset', () => {
    const contract = Contract.create({
      name: 'acme',
      version: '0.1.0',
    }).operation({
      id: 'projects.delete',
      command: ['projects', 'delete'],
      locality: { modes: ['remote'], default: 'remote' },
      input: z.object({ projectId: z.string() }),
      output: z.object({ deleted: z.boolean() }),
      effects: { kind: 'delete' },
    })
    const op = normalizeContract(contract).operations[0]!
    expect(op.verb).toBe('delete')
    expect(op.effects).toEqual({ kind: 'delete', idempotent: true, dangerous: true })
    expect(op.policy).toEqual({
      idempotent: true,
      destructive: true,
      requiresConfirmation: true,
      conformance: 'auto',
    })
  })

  test('remote.bind defaults to body=false and empty path/query/headers', () => {
    const contract = Contract.create({
      name: 'acme',
      version: '0.1.0',
    }).operation({
      id: 'projects.get',
      command: ['projects', 'get'],
      locality: { modes: ['remote'], default: 'remote' },
      input: z.object({ projectId: z.string() }),
      output: z.object({ project: z.object({ id: z.string() }) }),
      effects: { kind: 'read' },
      remote: { method: 'GET', path: '/projects/{projectId}' },
    })
    const op = normalizeContract(contract).operations[0]!
    expect(op.remote?.bind).toEqual({ path: [], query: [], headers: {}, body: false })
  })

  test('emits JSON Schema projection for input and output', () => {
    const contract = Contract.create({
      name: 'acme',
      version: '0.1.0',
    }).operation(projectsGet())
    const op = normalizeContract(contract).operations[0]!
    expect(op.input.jsonSchema).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false,
    })
    expect(op.input.portability).toEqual({ openapi: true, mcp: true, docs: true, reasons: [] })
  })

  test('examples default to [] when omitted', () => {
    const contract = Contract.create({
      name: 'acme',
      version: '0.1.0',
    }).operation(projectsGet())
    const op = normalizeContract(contract).operations[0]!
    expect(op.examples).toEqual([])
  })
})
