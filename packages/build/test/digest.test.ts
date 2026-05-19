import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { canonicalDigest, Contract, normalizeContract } from '../src/index.js'

function buildA() {
  return Contract.create({
    name: 'acme',
    version: '0.1.0',
  }).operation({
    id: 'projects.get',
    command: ['projects', 'get'],
    locality: { modes: ['local', 'remote'], default: 'local' },
    input: z.object({ projectId: z.string(), includeDeployments: z.boolean().default(false) }),
    output: z.object({ project: z.object({ id: z.string(), name: z.string() }) }),
    effects: { kind: 'read' },
    local: { module: './impl/projects.ts', export: 'getProject' },
  })
}

function buildBReordered() {
  // Same contract, properties supplied in different order on every nested level.
  return Contract.create({
    version: '0.1.0',
    name: 'acme',
  }).operation({
    effects: { kind: 'read' },
    local: { export: 'getProject', module: './impl/projects.ts' },
    output: z.object({ project: z.object({ name: z.string(), id: z.string() }) }),
    input: z.object({ includeDeployments: z.boolean().default(false), projectId: z.string() }),
    locality: { default: 'local', modes: ['local', 'remote'] },
    command: ['projects', 'get'],
    id: 'projects.get',
  })
}

describe('canonicalDigest', () => {
  test('produces sha256:<hex> format', () => {
    const digest = canonicalDigest({ a: 1 })
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  test('two semantically identical contracts with reordered keys produce identical digests', () => {
    const irA = normalizeContract(buildA())
    const irB = normalizeContract(buildBReordered())
    expect(canonicalDigest(irA)).toBe(canonicalDigest(irB))
  })

  test('two contracts with reordered input object properties but identical fields produce the same input projection digest', () => {
    const contract1 = Contract.create({
      name: 'acme',
      version: '0.1.0',
    }).operation({
      id: 'projects.get',
      command: ['projects', 'get'],
      locality: { modes: ['remote'], default: 'remote' },
      input: z.object({ a: z.string(), b: z.string() }),
      output: z.object({ ok: z.boolean() }),
      effects: { kind: 'read' },
    })
    const contract2 = Contract.create({
      name: 'acme',
      version: '0.1.0',
    }).operation({
      id: 'projects.get',
      command: ['projects', 'get'],
      locality: { modes: ['remote'], default: 'remote' },
      input: z.object({ b: z.string(), a: z.string() }),
      output: z.object({ ok: z.boolean() }),
      effects: { kind: 'read' },
    })
    const ir1 = normalizeContract(contract1).operations[0]!.input
    const ir2 = normalizeContract(contract2).operations[0]!.input
    expect(canonicalDigest(ir1)).toBe(canonicalDigest(ir2))
  })

  test('changing a field name in input changes the digest', () => {
    const contract1 = Contract.create({
      name: 'acme',
      version: '0.1.0',
    }).operation({
      id: 'projects.get',
      command: ['projects', 'get'],
      locality: { modes: ['remote'], default: 'remote' },
      input: z.object({ a: z.string() }),
      output: z.object({ ok: z.boolean() }),
      effects: { kind: 'read' },
    })
    const contract2 = Contract.create({
      name: 'acme',
      version: '0.1.0',
    }).operation({
      id: 'projects.get',
      command: ['projects', 'get'],
      locality: { modes: ['remote'], default: 'remote' },
      input: z.object({ b: z.string() }),
      output: z.object({ ok: z.boolean() }),
      effects: { kind: 'read' },
    })
    const d1 = canonicalDigest(normalizeContract(contract1))
    const d2 = canonicalDigest(normalizeContract(contract2))
    expect(d1).not.toBe(d2)
  })

  test('throws when value contains a function (functions are not digestable)', () => {
    expect(() => canonicalDigest({ run: () => 1 })).toThrow(/functions are not digestable/)
  })
})
