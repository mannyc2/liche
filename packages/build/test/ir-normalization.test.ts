import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  DEFAULT_GENERATED_VOCABULARY,
  defineProgram,
  normalizeProgram,
  operation,
  vocabulary,
} from '../src/index.js'

function projectsGet() {
  return operation({
    id: 'projects.get',
    verb: 'get',
    command: ['projects', 'get'],
    locality: { modes: ['local', 'remote'], default: 'local' },
    input: z.object({ projectId: z.string() }),
    output: z.object({ project: z.object({ id: z.string(), name: z.string() }) }),
    effects: { kind: 'read' },
    local: { module: './impl/projects.ts', export: 'getProject' },
  })
}

describe('normalizeProgram — base shape', () => {
  test('emits ProgramIR with default vocabulary baked in', () => {
    const program = defineProgram({
      name: 'acme',
      version: '0.1.0',
      operations: [projectsGet()],
    })
    const ir = normalizeProgram(program)

    expect(ir.kind).toBe('lili.program')
    expect(ir.irVersion).toBe(1)
    expect(ir.name).toBe('acme')
    expect(ir.version).toBe('0.1.0')
    expect(ir.vocabulary.verbs).toEqual([...DEFAULT_GENERATED_VOCABULARY.verbs])
    expect(ir.vocabulary.forbiddenFlags).toContain('format')
    expect(ir.operations).toHaveLength(1)
  })

  test('per-program vocabulary extensions merge with defaults', () => {
    const program = defineProgram({
      name: 'acme',
      version: '0.1.0',
      vocabulary: vocabulary({ verbs: ['deploy'], flags: ['dry-run'] }),
      operations: [projectsGet()],
    })
    const ir = normalizeProgram(program)
    expect(ir.vocabulary.verbs).toContain('deploy')
    expect(ir.vocabulary.verbs).toContain('get')
    expect(ir.vocabulary.flags).toContain('dry-run')
    expect(ir.vocabulary.flags).toContain('json')
  })
})

describe('normalizeProgram — operation IR', () => {
  test('derives policy from effects when policy is unset', () => {
    const program = defineProgram({
      name: 'acme',
      version: '0.1.0',
      operations: [
        operation({
          id: 'projects.delete',
          verb: 'delete',
          command: ['projects', 'delete'],
          locality: { modes: ['remote'], default: 'remote' },
          input: z.object({ projectId: z.string() }),
          output: z.object({ deleted: z.boolean() }),
          effects: { kind: 'delete' },
        }),
      ],
    })
    const op = normalizeProgram(program).operations[0]!
    expect(op.effects).toEqual({ kind: 'delete', idempotent: true, dangerous: true })
    expect(op.policy).toEqual({
      idempotent: true,
      destructive: true,
      requiresConfirmation: true,
      conformance: 'auto',
    })
  })

  test('remote.bind defaults to body=false and empty path/query/headers', () => {
    const program = defineProgram({
      name: 'acme',
      version: '0.1.0',
      operations: [
        operation({
          id: 'projects.get',
          verb: 'get',
          command: ['projects', 'get'],
          locality: { modes: ['remote'], default: 'remote' },
          input: z.object({ projectId: z.string() }),
          output: z.object({ project: z.object({ id: z.string() }) }),
          effects: { kind: 'read' },
          remote: { method: 'GET', path: '/projects/{projectId}' },
        }),
      ],
    })
    const op = normalizeProgram(program).operations[0]!
    expect(op.remote?.bind).toEqual({ path: [], query: [], headers: {}, body: false })
  })

  test('emits JSON Schema projection for input and output', () => {
    const program = defineProgram({
      name: 'acme',
      version: '0.1.0',
      operations: [projectsGet()],
    })
    const op = normalizeProgram(program).operations[0]!
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
    const program = defineProgram({
      name: 'acme',
      version: '0.1.0',
      operations: [projectsGet()],
    })
    const op = normalizeProgram(program).operations[0]!
    expect(op.examples).toEqual([])
  })
})
