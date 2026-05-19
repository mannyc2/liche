#!/usr/bin/env bun
import { dirname, isAbsolute, resolve } from 'node:path'
import { Cli, z } from '@lili/core'
import { checkAgainstDir, generateToDir } from './generate.js'
import { LI_BUILD_SKILL_INDEX, LI_BUILD_SKILL_MARKDOWN } from './skill.js'
import type { Contract } from './schema.js'

const GENERATOR_VERSION = '0.0.0'

async function loadContract(contractPath: string): Promise<Contract> {
  const absolute = isAbsolute(contractPath) ? contractPath : resolve(process.cwd(), contractPath)
  const mod = await import(absolute)
  const contract = mod.default as Contract | undefined
  if (!contract || contract.kind !== 'lili.contract') {
    throw new Error(`Module at ${absolute} does not default-export a Contract.create() result`)
  }
  return contract
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
  args: z.object({ contract: z.string() }),
  options: z.object({
    check: z.boolean().default(false),
    out: z.string().optional(),
  }),
  async run(ctx) {
    const contractPath = resolve(process.cwd(), ctx.args.contract)
    const outDir = ctx.options.out ? resolve(process.cwd(), ctx.options.out) : dirname(contractPath)
    const contract = await loadContract(contractPath)
    const options = { outDir, generatorVersion: GENERATOR_VERSION }

    if (ctx.options.check) {
      const result = await checkAgainstDir(contract, options)
      if (result.ok) return { inSync: true }
      return ctx.error({
        code: 'GENERATED_SURFACE_DRIFT',
        hint: result.drift.join('\n'),
        message: 'Generated artifacts are out of sync',
      })
    }

    const result = await generateToDir(contract, options)
    return {
      generatedPath: result.generatedPath,
      manifestPath: result.manifestPath,
    }
  },
})

if (import.meta.main) await cli.serve(process.argv.slice(2))
