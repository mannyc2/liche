#!/usr/bin/env bun
import { dirname, isAbsolute, resolve } from 'node:path'
import { Cli, z } from '@lili/core'
import { compileProduct } from './compile.js'
import type { CompileTarget } from './compile.js'
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
})

if (import.meta.main) await cli.serve(process.argv.slice(2))
