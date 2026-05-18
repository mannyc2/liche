import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineProgram, lintProgram, operation, vocabulary } from '../src/index.js'

function baseOperation(overrides: Partial<Parameters<typeof operation>[0]> = {}) {
  return operation({
    id: 'projects.get',
    verb: 'get',
    command: ['projects', 'get'],
    locality: { modes: ['local', 'remote'], default: 'local' },
    input: z.object({ projectId: z.string() }),
    output: z.object({ ok: z.boolean() }),
    effects: { kind: 'read' },
    ...overrides,
  })
}

function lint(spec: Parameters<typeof defineProgram>[0]) {
  return lintProgram(defineProgram(spec))
}

describe('lintProgram — vocabulary/verb', () => {
  test("'projects info' fails vocabulary/verb and recommends 'get'", () => {
    const issues = lint({
      name: 'acme',
      version: '0.1.0',
      operations: [baseOperation({ id: 'projects.info', verb: 'info', command: ['projects', 'info'] })],
    })
    const issue = issues.find((i) => i.code === 'vocabulary/verb')
    expect(issue).toBeDefined()
    expect(issue?.recommendation).toBe("use 'get' instead of 'info'")
  })

  test('unknown verb not in vocabulary fails vocabulary/verb', () => {
    const issues = lint({
      name: 'acme',
      version: '0.1.0',
      operations: [baseOperation({ id: 'projects.fetch', verb: 'fetch', command: ['projects', 'fetch'] })],
    })
    expect(issues.find((i) => i.code === 'vocabulary/verb')).toBeDefined()
  })
})

describe('lintProgram — vocabulary/forbidden flags', () => {
  test("control flag 'skipConfirmations' fails and recommends 'force'", () => {
    const issues = lint({
      name: 'acme',
      version: '0.1.0',
      vocabulary: vocabulary({ flags: ['skipConfirmations'] }),
      operations: [baseOperation()],
    })
    const forbidden = issues.find((i) => i.code === 'vocabulary/forbidden' && i.path.includes('skipConfirmations'))
    expect(forbidden).toBeDefined()
    expect(forbidden?.recommendation).toBe("use 'force' instead of 'skipConfirmations'")
  })

  test("control flag 'format' fails vocabulary/forbidden", () => {
    const issues = lint({
      name: 'acme',
      version: '0.1.0',
      vocabulary: vocabulary({ flags: ['format'] }),
      operations: [baseOperation()],
    })
    expect(issues.find((i) => i.code === 'vocabulary/forbidden' && i.path.includes('format'))).toBeDefined()
  })

  test("operation input field 'limit' does NOT trigger vocabulary/flag", () => {
    const issues = lint({
      name: 'acme',
      version: '0.1.0',
      operations: [
        baseOperation({
          id: 'projects.list',
          verb: 'list',
          command: ['projects', 'list'],
          input: z.object({ limit: z.number().default(20), includeDeployments: z.boolean().default(false) }),
        }),
      ],
    })
    expect(issues.filter((i) => i.code.startsWith('vocabulary/'))).toEqual([])
  })
})

describe('lintProgram — operation/id-stable', () => {
  test('kebab-case id fails id-stable', () => {
    const issues = lint({
      name: 'acme',
      version: '0.1.0',
      operations: [baseOperation({ id: 'projects-get' })],
    })
    expect(issues.find((i) => i.code === 'operation/id-stable')).toBeDefined()
  })

  test('dot-segmented camelCase id passes', () => {
    const issues = lint({
      name: 'acme',
      version: '0.1.0',
      operations: [baseOperation({ id: 'projects.getOne' })],
    })
    expect(issues.find((i) => i.code === 'operation/id-stable')).toBeUndefined()
  })
})

describe('lintProgram — operation/locality-required', () => {
  test('default not in modes fails', () => {
    const issues = lint({
      name: 'acme',
      version: '0.1.0',
      operations: [
        baseOperation({ locality: { modes: ['local'], default: 'remote' } }),
      ],
    })
    expect(issues.find((i) => i.code === 'operation/locality-required')).toBeDefined()
  })

  test('empty modes fails', () => {
    const issues = lint({
      name: 'acme',
      version: '0.1.0',
      operations: [
        baseOperation({ locality: { modes: [], default: 'local' as 'local' } }),
      ],
    })
    expect(issues.find((i) => i.code === 'operation/locality-required')).toBeDefined()
  })
})

describe('lintProgram — operation/output-required', () => {
  test('z.void output fails', () => {
    const issues = lint({
      name: 'acme',
      version: '0.1.0',
      operations: [baseOperation({ output: z.void() as unknown as z.ZodType })],
    })
    expect(issues.find((i) => i.code === 'operation/output-required')).toBeDefined()
  })
})

describe('lintProgram — clean program', () => {
  test('valid CRUD + workflow produces no issues', () => {
    const issues = lint({
      name: 'acme',
      version: '0.1.0',
      operations: [
        baseOperation(),
        baseOperation({
          id: 'projects.deploy',
          verb: 'run',
          command: ['projects', 'deploy'],
          effects: { kind: 'exec' },
        }),
      ],
    })
    expect(issues).toEqual([])
  })
})
