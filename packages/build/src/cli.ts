#!/usr/bin/env bun
import { dirname, isAbsolute, resolve } from 'node:path'
import { checkAgainstDir, generateToDir } from './generate.js'
import type { RuntimeNormalizedProgram } from './schema.js'

const GENERATOR_VERSION = '0.0.0'

type ParsedArgs = {
  command: 'generate'
  program: string
  outDir?: string
  check: boolean
}

function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  if (argv[0] !== 'generate') return { error: `unknown command '${argv[0] ?? ''}'. usage: li-build generate [--check] <program> [--out <dir>]` }
  const rest = argv.slice(1)
  let check = false
  let outDir: string | undefined
  let program: string | undefined
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!
    if (token === '--check') check = true
    else if (token === '--out' || token === '-o') {
      const v = rest[++i]
      if (!v) return { error: `missing value for ${token}` }
      outDir = v
    } else if (!program) {
      program = token
    } else {
      return { error: `unexpected argument '${token}'` }
    }
  }
  if (!program) return { error: 'missing <program> path' }
  return { command: 'generate', program, ...(outDir !== undefined ? { outDir } : {}), check }
}

async function loadProgram(programPath: string): Promise<RuntimeNormalizedProgram> {
  const absolute = isAbsolute(programPath) ? programPath : resolve(process.cwd(), programPath)
  const mod = await import(absolute)
  const runtime = mod.default as RuntimeNormalizedProgram | undefined
  if (!runtime || runtime.kind !== 'lili.runtime-program') {
    throw new Error(`Module at ${absolute} does not default-export a defineProgram() result`)
  }
  return runtime
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2))
  if ('error' in parsed) {
    process.stderr.write(`li-build: ${parsed.error}\n`)
    return 1
  }
  const programPath = resolve(process.cwd(), parsed.program)
  const outDir = parsed.outDir ? resolve(process.cwd(), parsed.outDir) : dirname(programPath)

  const runtime = await loadProgram(programPath)
  const options = { outDir, generatorVersion: GENERATOR_VERSION }

  if (parsed.check) {
    const result = await checkAgainstDir(runtime, options)
    if (result.ok) {
      process.stdout.write(`li-build: generated artifacts are in sync\n`)
      return 0
    }
    for (const drift of result.drift) process.stderr.write(`li-build: drift — ${drift}\n`)
    return 1
  }
  const result = await generateToDir(runtime, options)
  process.stdout.write(`li-build: wrote ${result.generatedPath}\n`)
  process.stdout.write(`li-build: wrote ${result.manifestPath}\n`)
  return 0
}

const code = await main()
process.exit(code)
