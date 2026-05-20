#!/usr/bin/env bun
import { resolve } from 'node:path'
import { Cli, z } from '@lili/core'
import { compileEntrypoint } from './compile.js'
import type { CompileTarget } from './compile.js'

const BUILD_TOOL_VERSION = '0.0.0'

export const cli = Cli.create('li-build', {
  builtins: { completions: true },
  version: BUILD_TOOL_VERSION,
}).command('compile-entry', {
  alias: { out: 'o' },
  args: z.object({ entrypoint: z.string() }),
  options: z.object({
    commit: z.string(),
    contractDigest: z.string(),
    out: z.string(),
    releaseVersion: z.string(),
    target: z.string(),
  }),
  async run(ctx) {
    const result = await compileEntrypoint({
      entrypoint: resolve(process.cwd(), ctx.args.entrypoint),
      outfile: resolve(process.cwd(), ctx.options.out),
      target: ctx.options.target as CompileTarget,
      constants: {
        releaseVersion: ctx.options.releaseVersion,
        contractDigest: ctx.options.contractDigest,
        sourceCommit: ctx.options.commit,
        buildToolVersion: BUILD_TOOL_VERSION,
      },
    })

    if (!result.ok) {
      const hint = result.logs.length > 0
        ? result.logs.map((log) => String(log)).join('\n')
        : result.error === undefined ? undefined : String(result.error)
      return ctx.error({
        code: 'COMPILE_FAILED',
        message: 'Bun.build failed',
        ...(hint === undefined ? {} : { hint }),
      })
    }

    return {
      outfile: result.plan.outfile,
      entrypoint: result.plan.entrypoint,
      compileFlagsDigest: result.plan.compileFlagsDigest,
    }
  },
})

if (import.meta.main) await cli.serve(process.argv.slice(2))
