import { describe, expect, test } from 'bun:test'
import {
  canonicalDigest,
  compileEntrypoint,
  createCompilePlan,
  renderCompileEntrypoint,
} from '../src/index.js'
import type { BunBuildFn } from '../src/index.js'

type BunBuildOptions = Parameters<typeof Bun.build>[0]
type BunBuildOutput = Awaited<ReturnType<typeof Bun.build>>

const constants = {
  releaseVersion: '1.2.3',
  contractDigest: 'sha256:contract',
  sourceCommit: '0123456789abcdef',
  buildToolVersion: '0.0.0',
}

function successfulBuild(captured: BunBuildOptions[]): BunBuildFn {
  return async (options) => {
    captured.push(options)
    return { success: true, outputs: [], logs: [] } as BunBuildOutput
  }
}

describe('compile profile', () => {
  test('derives deterministic Bun.build options from one flag profile', () => {
    const plan = createCompilePlan({
      entrypoint: '/tmp/a/liche.compile-entry.ts',
      outfile: '/tmp/a/workers',
      target: 'bun-linux-x64-baseline',
      constants,
      metafile: true,
    })

    expect(plan.flags).toEqual({
      target: 'bun-linux-x64-baseline',
      minify: true,
      sourcemap: 'linked',
      bytecode: true,
      packages: 'bundle',
      autoload: {
        bunfig: false,
        dotenv: false,
        packageJson: false,
        tsconfig: false,
      },
      define: {
        LICHE_BUILD_VERSION: '"1.2.3"',
        LICHE_CONTRACT_DIGEST: '"sha256:contract"',
        LICHE_SOURCE_COMMIT: '"0123456789abcdef"',
        LICHE_BUILD_TOOL_VERSION: '"0.0.0"',
      },
    })
    expect(plan.compileFlagsDigest).toBe(canonicalDigest(plan.flags))
    expect(plan.buildOptions).toMatchObject({
      entrypoints: ['/tmp/a/liche.compile-entry.ts'],
      compile: {
        target: 'bun-linux-x64-baseline',
        outfile: '/tmp/a/workers',
        autoloadBunfig: false,
        autoloadDotenv: false,
        autoloadPackageJson: false,
        autoloadTsconfig: false,
      },
      minify: true,
      sourcemap: 'linked',
      bytecode: true,
      packages: 'bundle',
      define: plan.flags.define,
      metafile: true,
      throw: false,
    })
  })

  test('compileFlagsDigest does not include local paths', () => {
    const a = createCompilePlan({
      entrypoint: '/tmp/a/liche.compile-entry.ts',
      outfile: '/tmp/a/workers',
      target: 'bun-linux-x64-baseline',
      constants,
    })
    const b = createCompilePlan({
      entrypoint: '/tmp/b/other-entry.ts',
      outfile: '/tmp/b/workers',
      target: 'bun-linux-x64-baseline',
      constants,
    })

    expect(a.compileFlagsDigest).toBe(b.compileFlagsDigest)
    expect(a.buildOptions.entrypoints).not.toEqual(b.buildOptions.entrypoints)
    expect(a.buildOptions.compile).not.toEqual(b.buildOptions.compile)
  })

  test('compile entrypoint runs the generated CLI default export', () => {
    expect(renderCompileEntrypoint('workers.generated.ts')).toBe(
      '#!/usr/bin/env bun\n' +
        "import { run } from '@liche/core'\n" +
        'import cli from "./workers.generated.js"\n' +
        '\n' +
        'await run(cli, process.argv.slice(2))\n',
    )
  })

  test('compileEntrypoint calls injected Bun.build with the planned options', async () => {
    const captured: BunBuildOptions[] = []
    const result = await compileEntrypoint(
      {
        entrypoint: '/tmp/a/liche.compile-entry.ts',
        outfile: '/tmp/a/workers',
        target: 'bun-linux-x64-baseline',
        constants,
      },
      successfulBuild(captured),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const options = captured[0]
    expect(options).toBeDefined()
    if (options === undefined) return
    expect(result.plan.buildOptions).toBe(options)
    expect(options.entrypoints).toEqual(['/tmp/a/liche.compile-entry.ts'])
    expect(options.compile).toMatchObject({
      target: 'bun-linux-x64-baseline',
      outfile: '/tmp/a/workers',
      autoloadBunfig: false,
      autoloadDotenv: false,
    })
  })

  test('compileEntrypoint reports a failed Bun.build result without throwing', async () => {
    const result = await compileEntrypoint(
      {
        entrypoint: '/tmp/a/liche.compile-entry.ts',
        outfile: '/tmp/a/workers',
        target: 'bun-linux-x64-baseline',
        constants,
      },
      async () =>
        ({ success: false, outputs: [], logs: [{ message: 'bad build' }] } as unknown as BunBuildOutput),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.logs).toEqual([{ message: 'bad build' }])
  })
})
