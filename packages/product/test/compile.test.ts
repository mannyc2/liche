import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { renderCompileEntrypoint } from '@liche/build'
import type { BunBuildFn } from '@liche/build'
import {
  canonicalDigest,
  compileProduct,
  normalizeProduct,
} from '../src/index.js'
import product from './fixtures/workers.product.js'

type BunBuildOptions = Parameters<typeof Bun.build>[0]
type BunBuildOutput = Awaited<ReturnType<typeof Bun.build>>

const constants = {
  releaseVersion: '1.2.3',
  sourceCommit: '0123456789abcdef',
  generatorVersion: '0.0.0',
}

function successfulBuild(captured: BunBuildOptions[]): BunBuildFn {
  return async (options) => {
    captured.push(options)
    return { success: true, outputs: [], logs: [] } as BunBuildOutput
  }
}

describe('compileProduct', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liche-product-compile-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('generates a compile entrypoint and calls injected Bun.build', async () => {
    const captured: BunBuildOptions[] = []
    const result = await compileProduct(
      product,
      {
        outDir: dir,
        outfile: join(dir, 'workers'),
        target: 'bun-linux-x64-baseline',
        sourceCommit: constants.sourceCommit,
        generatorVersion: constants.generatorVersion,
        releaseVersion: constants.releaseVersion,
      },
      successfulBuild(captured),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await Bun.file(result.compileEntrypointPath).text()).toBe(renderCompileEntrypoint())
    expect(result.generated.generatedPath).toBe(join(dir, 'liche.generated.ts'))
    expect(result.plan.flags.define.LICHE_CONTRACT_DIGEST).toBe(
      JSON.stringify(canonicalDigest(normalizeProduct(product))),
    )

    const options = captured[0]
    expect(options).toBeDefined()
    if (options === undefined) return
    expect(options.entrypoints).toEqual([join(dir, 'liche.compile-entry.ts')])
    expect(options.compile).toMatchObject({
      target: 'bun-linux-x64-baseline',
      outfile: join(dir, 'workers'),
      autoloadBunfig: false,
      autoloadDotenv: false,
    })
  })

  test('reports a failed Bun.build result without throwing', async () => {
    const result = await compileProduct(
      product,
      {
        outDir: dir,
        outfile: join(dir, 'workers'),
        target: 'bun-linux-x64-baseline',
        sourceCommit: constants.sourceCommit,
        generatorVersion: constants.generatorVersion,
      },
      async () =>
        ({ success: false, outputs: [], logs: [{ message: 'bad build' }] } as unknown as BunBuildOutput),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.logs).toEqual([{ message: 'bad build' }])
    expect(await Bun.file(result.compileEntrypointPath).exists()).toBe(true)
  })
})
