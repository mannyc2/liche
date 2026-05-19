import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { Contract, lintContract, vocabulary, type ContractInit, type Operation } from '../src/index.js'

function baseOperation(
  overrides: Partial<Operation> = {},
  bindings: { local?: boolean; remote?: boolean } = { local: true, remote: true },
): Operation {
  const op: Operation = {
    id: 'projects.get',
    command: ['projects', 'get'],
    locality: { modes: ['local', 'remote'], default: 'local' },
    input: z.object({ projectId: z.string() }),
    output: z.object({ ok: z.boolean() }),
    effects: { kind: 'read' },
    ...overrides,
  }
  if (bindings.local && !('local' in overrides)) op.local = { module: './impl/projects.ts', export: 'getProject' }
  if (bindings.remote && !('remote' in overrides)) op.remote = { method: 'GET', path: '/projects/{projectId}', bind: { path: ['projectId'] } }
  return op
}

function contract(init: ContractInit, operations: readonly Operation[]) {
  const c = Contract.create(init)
  for (const op of operations) c.operation(op)
  return c
}

describe('lintContract — vocabulary/verb', () => {
  test("'projects info' fails vocabulary/verb when info is not in vocabulary", () => {
    const issues = lintContract(contract(
      { name: 'acme', version: '0.1.0' },
      [baseOperation({ id: 'projects.info', command: ['projects', 'info'] })],
    ))
    const issue = issues.find((i) => i.code === 'vocabulary/verb')
    expect(issue).toBeDefined()
    expect(issue?.recommendation).toContain("add 'info'")
  })

  test('unknown command action not in vocabulary fails vocabulary/verb', () => {
    const issues = lintContract(contract(
      { name: 'acme', version: '0.1.0' },
      [baseOperation({ id: 'projects.fetch', command: ['projects', 'fetch'] })],
    ))
    expect(issues.find((i) => i.code === 'vocabulary/verb')).toBeDefined()
  })

  test('contract vocabulary can allow non-default command actions', () => {
    const issues = lintContract(contract({
      name: 'builder',
      version: '0.1.0',
      vocabulary: vocabulary({ verbs: ['generate'] }),
    }, [baseOperation({ id: 'build.generate', command: ['generate'] })]))
    expect(issues.find((i) => i.code === 'vocabulary/verb')).toBeUndefined()
  })

  test('explicit vocabulary can opt out of default verbs', () => {
    const issues = lintContract(contract({
      name: 'builder',
      version: '0.1.0',
      vocabulary: { aliases: {}, flags: ['json'], verbs: ['generate'] },
    }, [baseOperation()]))
    expect(issues.find((i) => i.code === 'vocabulary/verb')).toBeDefined()
  })
})

describe('lintContract — vocabulary/flags', () => {
  test("control flag 'format' can be included in vocabulary", () => {
    const issues = lintContract(contract({
      name: 'acme',
      version: '0.1.0',
      vocabulary: vocabulary({ flags: ['format'] }),
    }, [baseOperation()]))
    expect(issues.filter((i) => i.code.startsWith('vocabulary/'))).toEqual([])
  })

  test("operation input field 'limit' does NOT trigger vocabulary/flag", () => {
    const issues = lintContract(contract(
      { name: 'acme', version: '0.1.0' },
      [
        baseOperation({
          id: 'projects.list',
          command: ['projects', 'list'],
          input: z.object({ limit: z.number().default(20), includeDeployments: z.boolean().default(false) }),
        }),
      ],
    ))
    expect(issues.filter((i) => i.code.startsWith('vocabulary/'))).toEqual([])
  })
})

describe('lintContract — operation/id-stable', () => {
  test('kebab-case id fails id-stable', () => {
    const issues = lintContract(contract(
      { name: 'acme', version: '0.1.0' },
      [baseOperation({ id: 'projects-get' })],
    ))
    expect(issues.find((i) => i.code === 'operation/id-stable')).toBeDefined()
  })

  test('dot-segmented camelCase id passes', () => {
    const issues = lintContract(contract(
      { name: 'acme', version: '0.1.0' },
      [baseOperation({ id: 'projects.getOne' })],
    ))
    expect(issues.find((i) => i.code === 'operation/id-stable')).toBeUndefined()
  })
})

describe('lintContract — operation/locality-required', () => {
  test('default not in modes fails', () => {
    const issues = lintContract(contract(
      { name: 'acme', version: '0.1.0' },
      [
        baseOperation({ locality: { modes: ['local'], default: 'remote' } }),
      ],
    ))
    expect(issues.find((i) => i.code === 'operation/locality-required')).toBeDefined()
  })

  test('empty modes fails', () => {
    const issues = lintContract(contract(
      { name: 'acme', version: '0.1.0' },
      [
        baseOperation({ locality: { modes: [], default: 'local' as 'local' } }),
      ],
    ))
    expect(issues.find((i) => i.code === 'operation/locality-required')).toBeDefined()
  })
})

describe('lintContract — operation/locality-binding', () => {
  test('local mode without local binding fails', () => {
    const issues = lintContract(contract(
      { name: 'acme', version: '0.1.0' },
      [baseOperation({}, { local: false, remote: true })],
    ))
    const issue = issues.find((i) => i.code === 'operation/locality-binding' && i.path.endsWith('.local'))
    expect(issue).toBeDefined()
    expect(issue?.recommendation).toContain("remove 'local'")
  })

  test('remote mode without remote binding fails', () => {
    const issues = lintContract(contract(
      { name: 'acme', version: '0.1.0' },
      [baseOperation({}, { local: true, remote: false })],
    ))
    const issue = issues.find((i) => i.code === 'operation/locality-binding' && i.path.endsWith('.remote'))
    expect(issue).toBeDefined()
    expect(issue?.recommendation).toContain("remove 'remote'")
  })
})

describe('lintContract — contract/remote-base-url', () => {
  test('remote config without envVar or literal fails', () => {
    const issues = lintContract(contract(
      {
        name: 'acme',
        version: '0.1.0',
        remote: { baseUrl: {} as never },
      },
      [],
    ))
    expect(issues.find((i) => i.code === 'contract/remote-base-url')).toBeDefined()
  })

  test('remote config with envVar passes base URL lint', () => {
    const issues = lintContract(contract(
      {
        name: 'acme',
        version: '0.1.0',
        remote: { baseUrl: { envVar: 'ACME_API_URL' } },
      },
      [],
    ))
    expect(issues.find((i) => i.code === 'contract/remote-base-url')).toBeUndefined()
  })
})

describe('lintContract — operation/output-required', () => {
  test('z.void output fails', () => {
    const issues = lintContract(contract(
      { name: 'acme', version: '0.1.0' },
      [baseOperation({ output: z.void() as unknown as z.ZodType })],
    ))
    expect(issues.find((i) => i.code === 'operation/output-required')).toBeDefined()
  })
})

describe('lintContract — clean contract', () => {
  test('valid CRUD + workflow produces no issues when workflow action is in vocabulary', () => {
    const issues = lintContract(contract({
      name: 'acme',
      version: '0.1.0',
      vocabulary: vocabulary({ verbs: ['deploy'] }),
    }, [
        baseOperation(),
        baseOperation({
          id: 'projects.deploy',
          command: ['projects', 'deploy'],
          effects: { kind: 'exec' },
        }),
      ]))
    expect(issues).toEqual([])
  })
})
