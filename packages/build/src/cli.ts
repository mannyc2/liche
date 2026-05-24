#!/usr/bin/env bun
import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { defineCli, defineCommand, z } from '@liche/core'
import { completions, config } from '@liche/extensions'
import { buildBinaries } from './build.js'
import { compileEntrypoint } from './compile.js'
import type { CompileTarget } from './compile.js'
import { isTargetPreset } from './targets.js'
import type { TargetSelection } from './targets.js'

const BUILD_TOOL_VERSION = '0.3.1'

const BuildCliConfigSchema = z.object({
  build: z.object({
    targets: z.string().optional(),
    out: z.string().optional(),
    record: z.string().optional(),
    parallel: z.boolean().optional(),
  }).strict().optional(),
  compileEntry: z.object({
    target: z.string().optional(),
    out: z.string().optional(),
  }).strict().optional(),
}).strict()

function parseTargets(raw: string): TargetSelection {
  const trimmed = raw.trim()
  if (isTargetPreset(trimmed)) return trimmed
  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

export const cli = defineCli({
  commands: [
    defineCommand({
      path: ['compile-entry'],
      input: {
        aliases: { out: 'o' },
        args: z.object({ entrypoint: z.string() }),
        config: {
          out: 'compileEntry.out',
          target: 'compileEntry.target',
        },
        options: z.object({
          commit: z.string(),
          contractDigest: z.string(),
          out: z.string(),
          releaseVersion: z.string(),
          target: z.string(),
        }),
      },
      async run({ ctx, input }) {
        const result = await compileEntrypoint({
          entrypoint: resolve(process.cwd(), input.args.entrypoint),
          outfile: resolve(process.cwd(), input.options.out),
          target: input.options.target as CompileTarget,
          constants: {
            releaseVersion: input.options.releaseVersion,
            contractDigest: input.options.contractDigest,
            sourceCommit: input.options.commit,
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
    }),
    defineCommand({
      path: ['build'],
      input: {
        aliases: { out: 'o' },
        args: z.object({ entrypoint: z.string() }),
        config: {
          out: 'build.out',
          parallel: 'build.parallel',
          record: 'build.record',
          targets: 'build.targets',
        },
        options: z.object({
          targets: z.string(),
          releaseVersion: z.string(),
          commit: z.string(),
          contractDigest: z.string(),
          out: z.string(),
          record: z.string().optional(),
          parallel: z.boolean().default(true),
        }),
      },
      async run({ ctx, input }) {
        const result = await buildBinaries({
          entrypoint: resolve(process.cwd(), input.args.entrypoint),
          targets: parseTargets(input.options.targets),
          constants: {
            releaseVersion: input.options.releaseVersion,
            contractDigest: input.options.contractDigest,
            sourceCommit: input.options.commit,
            buildToolVersion: BUILD_TOOL_VERSION,
          },
          outDir: resolve(process.cwd(), input.options.out),
          parallel: input.options.parallel,
        })

        if (input.options.record) {
          const recordPath = resolve(process.cwd(), input.options.record)
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
          ...(input.options.record ? { record: input.options.record } : {}),
        }
      },
    }),
  ],
  extensions: [
    completions(),
    config({
      files: ['liche-build.json', 'liche-build.jsonc', 'liche-build.yaml', 'liche-build.yml', 'liche-build.toml'],
      schema: BuildCliConfigSchema,
      scopes: {
        project: { discoverUpwards: true },
        user: { xdg: true },
      },
    }),
  ],
  name: 'liche-build',
  version: BUILD_TOOL_VERSION,
})

if (import.meta.main) await cli.serve(process.argv.slice(2))
