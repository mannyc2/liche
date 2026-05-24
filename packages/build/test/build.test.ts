import { afterAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildBinaries, parseBuildRecord } from '../src/index.js'
import type { BuildBinariesInput, BunBuildFn } from '../src/index.js'

const tmp = mkdtempSync(join(tmpdir(), 'liche-build-build-'))

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

type BunBuildOptions = Parameters<typeof Bun.build>[0]
type BunBuildOutput = Awaited<ReturnType<typeof Bun.build>>

function compileObject(
  options: BunBuildOptions,
): { outfile?: string; target?: string } {
  const compile = options.compile
  if (compile && typeof compile === 'object') {
    return compile as { outfile?: string; target?: string }
  }
  return {}
}

const constants = {
  releaseVersion: '1.2.3',
  contractDigest: 'sha256:contract',
  sourceCommit: '0123456789abcdef',
  buildToolVersion: '0.0.0',
}

function recordingBuild(captured: BunBuildOptions[], payload: string): BunBuildFn {
  return async (options) => {
    captured.push(options)
    const { outfile, target } = compileObject(options)
    if (typeof outfile === 'string') {
      await Bun.write(outfile, `${payload}:${target ?? 'unknown'}`)
    }
    return { success: true, outputs: [], logs: [] } as BunBuildOutput
  }
}

function failingBuild(forTargets: readonly string[]): BunBuildFn {
  return async (options) => {
    const { outfile, target } = compileObject(options)
    if (target && forTargets.includes(target)) {
      return { success: false, outputs: [], logs: [{ message: `boom ${target}` }] } as unknown as BunBuildOutput
    }
    if (typeof outfile === 'string') {
      await Bun.write(outfile, `ok:${target ?? 'unknown'}`)
    }
    return { success: true, outputs: [], logs: [] } as BunBuildOutput
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

let runCounter = 0

function freshOutDir(label: string): string {
  runCounter += 1
  return join(tmp, `${label}-${runCounter}`)
}

function inputFor(label: string, overrides: Partial<BuildBinariesInput>): BuildBinariesInput {
  return {
    entrypoint: '/virtual/liche.compile-entry.ts',
    targets: ['darwin-arm64'],
    constants,
    outDir: freshOutDir(label),
    ...overrides,
  }
}

describe('buildBinaries', () => {
  test('compiles each target in parallel and produces a BuildRecord with sha256 + size', async () => {
    const captured: BunBuildOptions[] = []
    const result = await buildBinaries(
      inputFor('happy', {
        targets: ['darwin-arm64', 'linux-x64', 'windows-x64'],
        buildFn: recordingBuild(captured, 'payload'),
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(captured.map((c) => compileObject(c).target).sort()).toEqual([
      'bun-darwin-arm64',
      'bun-linux-x64',
      'bun-windows-x64',
    ])
    expect(result.record.recordVersion).toBe(1)
    expect(result.record.constants).toEqual(constants)
    expect(result.record.binaries.map((b) => b.id)).toEqual([
      'darwin-arm64',
      'linux-x64',
      'windows-x64',
    ])
    const windows = result.record.binaries.find((b) => b.id === 'windows-x64')!
    expect(windows.filename).toBe('cli.exe')
    expect(windows.sha256).toBe(sha256Hex('payload:bun-windows-x64'))
    expect(windows.size).toBe('payload:bun-windows-x64'.length)
    expect(windows.platform).toBe('windows')
    expect(windows.arch).toBe('x64')
  })

  test('resolves preset names via the targets table', async () => {
    const captured: BunBuildOptions[] = []
    const result = await buildBinaries(
      inputFor('preset', {
        targets: 'darwin-only',
        buildFn: recordingBuild(captured, 'preset'),
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.binaries.map((b) => b.id)).toEqual(['darwin-arm64', 'darwin-x64'])
  })

  test('preserves successful binaries when one target compile fails', async () => {
    const result = await buildBinaries(
      inputFor('partial', {
        targets: ['darwin-arm64', 'linux-x64', 'windows-x64'],
        buildFn: failingBuild(['bun-linux-x64']),
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.record.binaries.map((b) => b.id)).toEqual(['darwin-arm64', 'windows-x64'])
    expect(result.failures).toEqual([
      {
        targetId: 'linux-x64',
        code: 'COMPILE_FAILED',
        message: `compile failed for target 'linux-x64'`,
        details: { logs: '[object Object]' },
      },
    ])
  })

  test('reports unknown target ids before invoking Bun.build', async () => {
    let invoked = false
    const result = await buildBinaries(
      inputFor('unknown', {
        targets: ['darwin-arm64', 'made-up-target'],
        buildFn: async () => {
          invoked = true
          return { success: true, outputs: [], logs: [] } as BunBuildOutput
        },
      }),
    )
    expect(invoked).toBe(false)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures.map((f) => f.code)).toEqual(['TARGET_RESOLUTION_FAILED'])
    expect(result.failures[0]?.targetId).toBe('made-up-target')
    expect(result.record.binaries).toEqual([])
  })

  test('honors a custom filename', async () => {
    const captured: BunBuildOptions[] = []
    const result = await buildBinaries(
      inputFor('named', {
        targets: ['darwin-arm64', 'windows-x64'],
        filename: 'workers',
        buildFn: recordingBuild(captured, 'p'),
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const darwin = result.record.binaries.find((b) => b.id === 'darwin-arm64')!
    const windows = result.record.binaries.find((b) => b.id === 'windows-x64')!
    expect(darwin.filename).toBe('workers')
    expect(windows.filename).toBe('workers.exe')
  })

  test('emits a BuildRecord that round-trips through parseBuildRecord', async () => {
    const captured: BunBuildOptions[] = []
    const result = await buildBinaries(
      inputFor('roundtrip', {
        targets: ['darwin-arm64'],
        buildFn: recordingBuild(captured, 'rt'),
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const json = JSON.parse(JSON.stringify(result.record))
    const parsed = parseBuildRecord(json)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.record).toEqual(result.record)
  })

  test('serial mode runs targets in declared order', async () => {
    const order: string[] = []
    const result = await buildBinaries(
      inputFor('serial', {
        targets: ['linux-x64', 'darwin-arm64'],
        parallel: false,
        buildFn: async (options) => {
          const { outfile, target } = compileObject(options)
          if (target) order.push(target)
          if (typeof outfile === 'string') await Bun.write(outfile, `s:${target}`)
          return { success: true, outputs: [], logs: [] } as BunBuildOutput
        },
      }),
    )
    expect(result.ok).toBe(true)
    expect(order).toEqual(['bun-linux-x64', 'bun-darwin-arm64'])
  })
})
