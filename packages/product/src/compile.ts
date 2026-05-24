import {
  compileEntrypoint,
} from '@liche/build'
import type {
  BunBuildFn,
  CompileEntrypointFailure,
  CompileEntrypointSuccess,
  CompilePlan,
  CompileTarget,
} from '@liche/build'
import { generateToDir, type GenerateResult, type GenerateToDirOptions } from './generate.js'
import type { RuntimeProduct } from './product.js'

export type { BunBuildFn, CompilePlan, CompileTarget } from '@liche/build'

export type CompileProductOptions = GenerateToDirOptions & {
  outfile: string
  target: CompileTarget
  sourceCommit: string
  releaseVersion?: string
  compileEntryFileName?: string
  metafile?: boolean
}

export type CompileProductSuccess = {
  ok: true
  generated: GenerateResult
  compileEntrypointPath: string
  plan: CompilePlan
  build: CompileEntrypointSuccess['build']
}

export type CompileProductFailure = {
  ok: false
  generated: GenerateResult
  compileEntrypointPath: string
  plan: CompilePlan
  logs: unknown[]
  error?: unknown
}

export type CompileProductResult = CompileProductSuccess | CompileProductFailure

export async function compileProduct(
  product: RuntimeProduct,
  options: CompileProductOptions,
  build?: BunBuildFn,
): Promise<CompileProductResult> {
  const generated = await generateToDir(product, options)
  const compileEntrypointPath = generated.compileEntrypointPath

  const compileResult = await compileEntrypoint(
    {
      entrypoint: compileEntrypointPath,
      outfile: options.outfile,
      target: options.target,
      constants: {
        releaseVersion: options.releaseVersion ?? generated.manifest.schema.version,
        contractDigest: generated.manifest.schema.digest,
        sourceCommit: options.sourceCommit,
        buildToolVersion: options.generatorVersion,
      },
      ...(options.metafile === undefined ? {} : { metafile: options.metafile }),
    },
    build,
  )

  if (compileResult.ok) {
    return {
      ok: true,
      generated,
      compileEntrypointPath,
      plan: compileResult.plan,
      build: compileResult.build,
    }
  }

  return {
    ok: false,
    generated,
    compileEntrypointPath,
    plan: compileResult.plan,
    logs: compileResult.logs,
    ...compileError(compileResult),
  }
}

function compileError(result: CompileEntrypointFailure): { error?: unknown } {
  return result.error === undefined ? {} : { error: result.error }
}
