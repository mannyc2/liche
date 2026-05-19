#!/usr/bin/env bun
import { dirname, isAbsolute, resolve } from 'node:path'
import { Cli, z } from '@lili/core'
import { checkAgainstDir, generateToDir } from './generate.js'
import { Product } from './product.js'
import { LI_BUILD_SKILL_INDEX, LI_BUILD_SKILL_MARKDOWN } from './skill.js'

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

export const cli = Cli.create('li-build', {
  builtins: { completions: true, mcp: true, skills: true },
  skill: {
    index: LI_BUILD_SKILL_INDEX,
    markdown: LI_BUILD_SKILL_MARKDOWN,
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
})

if (import.meta.main) await cli.serve(process.argv.slice(2))
