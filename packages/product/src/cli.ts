#!/usr/bin/env bun
import { dirname, isAbsolute, resolve } from 'node:path'
import { defineCli, defineCommand, help, outputControls, reflectionControls, run, version, z } from '@liche/core'
import { completions, llms, mcpInstaller, skillsInstaller } from '@liche/extensions'
import { compileProduct } from './compile.js'
import type { CompileTarget } from './compile.js'
import { conformProduct, type ConformanceCase } from './conformance/index.js'
import { checkAgainstDir, generateToDir } from './generate/index.js'
import type { RuntimeProduct } from './product/types.js'
import { LI_PRODUCT_SKILL_INDEX, LI_PRODUCT_SKILL_MARKDOWN } from './skill.js'

const GENERATOR_VERSION = '0.8.1'

async function loadProduct(productPath: string): Promise<RuntimeProduct> {
  const absolute = isAbsolute(productPath) ? productPath : resolve(process.cwd(), productPath)
  const mod = await import(absolute)
  const product = mod.default as RuntimeProduct | undefined
  if (!product || product.kind !== 'liche.product') {
    throw new Error(`Module at ${absolute} does not default-export a defineProduct() result`)
  }
  return product
}

async function loadFixtures(fixturePath: string | undefined): Promise<ConformanceCase[] | undefined> {
  if (!fixturePath) return undefined
  const absolute = isAbsolute(fixturePath) ? fixturePath : resolve(process.cwd(), fixturePath)
  const mod = await import(absolute)
  const fixtures = mod.default as unknown
  if (!Array.isArray(fixtures)) {
    throw new Error(`Module at ${absolute} must default-export a ConformanceCase[]`)
  }
  return fixtures as ConformanceCase[]
}

export const cli = defineCli({
  commands: [
    defineCommand({
      path: ['generate'],
      input: {
        aliases: { out: 'o' },
        args: z.object({ product: z.string() }),
        options: z.object({
          check: z.boolean().default(false),
          out: z.string().optional(),
        }),
      },
      async run({ ctx, input }) {
        const productPath = resolve(process.cwd(), input.args.product)
        const outDir = input.options.out ? resolve(process.cwd(), input.options.out) : dirname(productPath)
        const product = await loadProduct(productPath)
        const options = { outDir, generatorVersion: GENERATOR_VERSION }

        if (input.options.check) {
          const result = await checkAgainstDir(product, options)
          if (result.ok) return { inSync: true }
          return ctx.error({
            code: 'GENERATED_SURFACE_DRIFT',
            code_actions: [{ title: 'Regenerate surfaces', command: `liche-product generate ${input.args.product}` }],
            hint: result.drift.join('\n'),
            message: 'Generated artifacts are out of sync',
            suggested_fix: 'Run generation without --check and commit the updated artifacts.',
          })
        }

        const result = await generateToDir(product, options)
        return {
          artifactPaths: Object.fromEntries(
            Object.entries(result.artifacts).map(([id, artifact]) => [id, artifact.path]),
          ),
          compileEntrypointPath: result.compileEntrypointPath,
          generatedPath: result.generatedPath,
          manifestPath: result.manifestPath,
        }
      },
    }),
    defineCommand({
      path: ['compile'],
      input: {
        aliases: { out: 'o' },
        args: z.object({ product: z.string() }),
        options: z.object({
          commit: z.string(),
          generatedOut: z.string().optional(),
          out: z.string(),
          releaseVersion: z.string().optional(),
          target: z.string(),
        }),
      },
      async run({ ctx, input }) {
        const productPath = resolve(process.cwd(), input.args.product)
        const outDir = input.options.generatedOut
          ? resolve(process.cwd(), input.options.generatedOut)
          : dirname(productPath)
        const product = await loadProduct(productPath)
        const compileOptions = {
          outDir,
          outfile: resolve(process.cwd(), input.options.out),
          target: input.options.target as CompileTarget,
          sourceCommit: input.options.commit,
          generatorVersion: GENERATOR_VERSION,
        }
        const result = await compileProduct(
          product,
          input.options.releaseVersion === undefined
            ? compileOptions
            : { ...compileOptions, releaseVersion: input.options.releaseVersion },
        )

        if (!result.ok) {
          const hint = result.logs.length > 0
            ? result.logs.map((log) => String(log)).join('\n')
            : result.error === undefined ? undefined : String(result.error)
          return ctx.error({
            code: 'COMPILE_FAILED',
            code_actions: [{
              title: 'Retry compile',
              argv: ['compile', input.args.product, '--out', input.options.out, '--target', input.options.target, '--commit', input.options.commit],
            }],
            message: 'Bun.build failed',
            ...(hint === undefined ? {} : { hint }),
            suggested_fix: 'Fix the Bun.build diagnostics, then rerun compile.',
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
      path: ['conform'],
      input: {
        aliases: { baseUrl: 'u', fixture: 'f', report: 'r' },
        args: z.object({ product: z.string() }),
        options: z.object({
          baseUrl: z.string().optional(),
          capability: z.string().optional(),
          fixture: z.string().optional(),
          includeDestructive: z.boolean().default(false),
          report: z.string().optional(),
        }),
      },
      async run({ ctx, input }) {
        const product = await loadProduct(resolve(process.cwd(), input.args.product))
        const fixtures = await loadFixtures(input.options.fixture)
        const conformOptions = {
          env: ctx.env as Record<string, string | undefined>,
          includeDestructive: input.options.includeDestructive,
        }
        const report = await conformProduct(product, {
          ...conformOptions,
          ...(input.options.baseUrl === undefined ? {} : { baseUrl: input.options.baseUrl }),
          ...(input.options.capability === undefined ? {} : { capability: input.options.capability }),
          ...(fixtures === undefined ? {} : { fixtures }),
        })
        if (input.options.report) {
          const reportPath = resolve(process.cwd(), input.options.report)
          await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`)
        }
        if (report.summary.failed > 0) {
          return ctx.error({
            code: 'CONFORMANCE_FAILED',
            code_actions: input.options.report
              ? [{ title: 'Inspect conformance report', command: `cat ${input.options.report}` }]
              : [{ title: 'Write conformance report', argv: ['conform', input.args.product, '--report', 'liche.conformance.json'] }],
            message: `${report.summary.failed} conformance case(s) failed`,
            hint: JSON.stringify(report.summary),
            suggested_fix: input.options.report
              ? `Inspect ${input.options.report}, fix the failing cases, and rerun conformance.`
              : 'Rerun with --report to inspect failing cases, then fix the product or remote fixture.',
          })
        }
        return report
      },
    }),
  ],
  extensions: [
    help(),
    version(),
    outputControls(),
    reflectionControls(),
    llms(),
    completions(),
    mcpInstaller(),
    skillsInstaller({
      skill: {
        index: LI_PRODUCT_SKILL_INDEX,
        markdown: LI_PRODUCT_SKILL_MARKDOWN,
      },
    }),
  ],
  name: 'liche-product',
  version: GENERATOR_VERSION,
})

if (import.meta.main) await run(cli, process.argv.slice(2))
