#!/usr/bin/env bun
import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { Cli, z } from '@lili/core'
import { buildBinaries } from './build.js'
import { compileEntrypoint } from './compile.js'
import type { CompileTarget } from './compile.js'
import { isTargetPreset } from './targets.js'
import type { TargetSelection } from './targets.js'

const BUILD_TOOL_VERSION = '0.0.0'

function parseTargets(raw: string): TargetSelection {
  const trimmed = raw.trim()
  if (isTargetPreset(trimmed)) return trimmed
  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

export const cli = Cli.create('li-build', {
  builtins: { completions: true },
  version: BUILD_TOOL_VERSION,
})
  .command('compile-entry', {
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
  .command('build', {
    alias: { out: 'o' },
    args: z.object({ entrypoint: z.string() }),
    options: z.object({
      targets: z.string(),
      releaseVersion: z.string(),
      commit: z.string(),
      contractDigest: z.string(),
      out: z.string(),
      record: z.string().optional(),
      parallel: z.boolean().default(true),
    }),
    async run(ctx) {
      const result = await buildBinaries({
        entrypoint: resolve(process.cwd(), ctx.args.entrypoint),
        targets: parseTargets(ctx.options.targets),
        constants: {
          releaseVersion: ctx.options.releaseVersion,
          contractDigest: ctx.options.contractDigest,
          sourceCommit: ctx.options.commit,
          buildToolVersion: BUILD_TOOL_VERSION,
        },
        outDir: resolve(process.cwd(), ctx.options.out),
        parallel: ctx.options.parallel,
      })

      if (ctx.options.record) {
        const recordPath = resolve(process.cwd(), ctx.options.record)
        await mkdir(dirname(recordPath), { recursive: true })
        await writeFile(recordPath, `${JSON.stringify(result.record, null, 2)}\n`)
      }

      if (!result.ok) {
        return ctx.error({
          code: 'BUILD_FAILED',
          message: `${result.failures.length} target(s) failed to build`,
          hint: result.failures
            .map((failure) => `${failure.targetId ?? '?'}: ${failure.code} ${failure.message}`)
            .join('\n'),
        })
      }

      return {
        binaries: result.record.binaries.map((binary) => ({
          id: binary.id,
          target: binary.target,
          path: binary.path,
          sha256: binary.sha256,
          size: binary.size,
        })),
        ...(ctx.options.record ? { record: ctx.options.record } : {}),
      }
    },
  })

if (import.meta.main) await cli.serve(process.argv.slice(2))
