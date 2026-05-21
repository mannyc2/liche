#!/usr/bin/env bun
import { dirname, isAbsolute, resolve } from 'node:path'
import { Cli, z } from '@lili/core'
import { compileProduct } from './compile.js'
import type { CompileTarget } from './compile.js'
import { conformProduct, type ConformanceCase } from './conformance.js'
import { checkAgainstDir, generateToDir } from './generate.js'
import { Product } from './product.js'
import { LI_PRODUCT_SKILL_INDEX, LI_PRODUCT_SKILL_MARKDOWN } from './skill.js'

const GENERATOR_VERSION = '0.0.0'

async function loadProduct(productPath: string): Promise<Product> {
  const absolute = isAbsolute(productPath) ? productPath : resolve(process.cwd(), productPath)
  const mod = await import(absolute)
  const product = mod.default as Product | undefined
  if (!product || product.kind !== 'lili.product') {
    throw new Error(`Module at ${absolute} does not default-export a Product.create() result`)
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

export const cli = Cli.create('li-product', {
  builtins: { completions: true, mcp: true, skills: true },
  skill: {
    index: LI_PRODUCT_SKILL_INDEX,
    markdown: LI_PRODUCT_SKILL_MARKDOWN,
  },
  version: GENERATOR_VERSION,
}).command('generate', {
  alias: { out: 'o' },
  args: z.object({ product: z.string() }),
  options: z.object({
    check: z.boolean().default(false),
    out: z.string().optional(),
  }),
  async run(ctx) {
    const productPath = resolve(process.cwd(), ctx.args.product)
    const outDir = ctx.options.out ? resolve(process.cwd(), ctx.options.out) : dirname(productPath)
    const product = await loadProduct(productPath)
    const options = { outDir, generatorVersion: GENERATOR_VERSION }

    if (ctx.options.check) {
      const result = await checkAgainstDir(product, options)
      if (result.ok) return { inSync: true }
      return ctx.error({
        code: 'GENERATED_SURFACE_DRIFT',
        hint: result.drift.join('\n'),
        message: 'Generated artifacts are out of sync',
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
}).command('compile', {
  alias: { out: 'o' },
  args: z.object({ product: z.string() }),
  options: z.object({
    commit: z.string(),
    generatedOut: z.string().optional(),
    out: z.string(),
    releaseVersion: z.string().optional(),
    target: z.string(),
  }),
  async run(ctx) {
    const productPath = resolve(process.cwd(), ctx.args.product)
    const outDir = ctx.options.generatedOut
      ? resolve(process.cwd(), ctx.options.generatedOut)
      : dirname(productPath)
    const product = await loadProduct(productPath)
    const compileOptions = {
      outDir,
      outfile: resolve(process.cwd(), ctx.options.out),
      target: ctx.options.target as CompileTarget,
      sourceCommit: ctx.options.commit,
      generatorVersion: GENERATOR_VERSION,
    }
    const result = await compileProduct(
      product,
      ctx.options.releaseVersion === undefined
        ? compileOptions
        : { ...compileOptions, releaseVersion: ctx.options.releaseVersion },
    )

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
}).command('conform', {
  alias: { baseUrl: 'u', fixture: 'f', report: 'r' },
  args: z.object({ product: z.string() }),
  options: z.object({
    baseUrl: z.string().optional(),
    capability: z.string().optional(),
    fixture: z.string().optional(),
    includeDestructive: z.boolean().default(false),
    report: z.string().optional(),
  }),
  async run(ctx) {
    const product = await loadProduct(resolve(process.cwd(), ctx.args.product))
    const fixtures = await loadFixtures(ctx.options.fixture)
    const conformOptions = {
      env: ctx.env as Record<string, string | undefined>,
      includeDestructive: ctx.options.includeDestructive,
    }
    const report = await conformProduct(product, {
      ...conformOptions,
      ...(ctx.options.baseUrl === undefined ? {} : { baseUrl: ctx.options.baseUrl }),
      ...(ctx.options.capability === undefined ? {} : { capability: ctx.options.capability }),
      ...(fixtures === undefined ? {} : { fixtures }),
    })
    if (ctx.options.report) {
      const reportPath = resolve(process.cwd(), ctx.options.report)
      await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    }
    if (report.summary.failed > 0) {
      return ctx.error({
        code: 'CONFORMANCE_FAILED',
        message: `${report.summary.failed} conformance case(s) failed`,
        hint: JSON.stringify(report.summary),
      })
    }
    return report
  },
})

if (import.meta.main) await cli.serve(process.argv.slice(2))
