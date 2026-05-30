import { canonicalDigest } from './digest.js'

type BunBuildOptions = Parameters<typeof Bun.build>[0]
type BunBuildOutput = Awaited<ReturnType<typeof Bun.build>>

export type BunBuildFn = (options: BunBuildOptions) => Promise<BunBuildOutput>
export type CompileTarget = Bun.Build.CompileTarget

export type CompileConstants = {
  releaseVersion: string
  contractDigest: string
  sourceCommit: string
  buildToolVersion: string
}

export type CompileFlagProfile = {
  target: CompileTarget
  minify: true
  sourcemap: 'linked'
  bytecode: true
  packages: 'bundle'
  autoload: {
    bunfig: false
    dotenv: false
    packageJson: false
    tsconfig: false
  }
  define: Record<
    'LICHE_BUILD_VERSION' | 'LICHE_CONTRACT_DIGEST' | 'LICHE_SOURCE_COMMIT' | 'LICHE_BUILD_TOOL_VERSION',
    string
  >
}

export type CompileMetafile = boolean

export type CompilePlan = {
  entrypoint: string
  outfile: string
  flags: CompileFlagProfile
  compileFlagsDigest: string
  buildOptions: BunBuildOptions
}

export type CreateCompilePlanInput = {
  entrypoint: string
  outfile: string
  target: CompileTarget
  constants: CompileConstants
  metafile?: CompileMetafile
}

export type CompileEntrypointSuccess = {
  ok: true
  plan: CompilePlan
  build: BunBuildOutput
}

export type CompileEntrypointFailure = {
  ok: false
  plan: CompilePlan
  logs: unknown[]
  error?: Error
}

export type CompileEntrypointResult = CompileEntrypointSuccess | CompileEntrypointFailure

export function createCompileFlagProfile(input: {
  target: CompileTarget
  constants: CompileConstants
}): CompileFlagProfile {
  return {
    target: input.target,
    minify: true,
    sourcemap: 'linked',
    bytecode: true,
    packages: 'bundle',
    autoload: {
      bunfig: false,
      dotenv: false,
      packageJson: false,
      tsconfig: false,
    },
    define: {
      LICHE_BUILD_VERSION: JSON.stringify(input.constants.releaseVersion),
      LICHE_CONTRACT_DIGEST: JSON.stringify(input.constants.contractDigest),
      LICHE_SOURCE_COMMIT: JSON.stringify(input.constants.sourceCommit),
      LICHE_BUILD_TOOL_VERSION: JSON.stringify(input.constants.buildToolVersion),
    },
  }
}

export function compileFlagsDigest(profile: CompileFlagProfile): string {
  return canonicalDigest(profile)
}

export function createCompilePlan(input: CreateCompilePlanInput): CompilePlan {
  const flags = createCompileFlagProfile({
    target: input.target,
    constants: input.constants,
  })
  const planWithoutOptions = {
    entrypoint: input.entrypoint,
    outfile: input.outfile,
    flags,
    compileFlagsDigest: compileFlagsDigest(flags),
  }
  const buildInput: {
    entrypoint: string
    outfile: string
    flags: CompileFlagProfile
    metafile?: CompileMetafile
  } = {
    entrypoint: input.entrypoint,
    outfile: input.outfile,
    flags,
  }
  if (input.metafile !== undefined) buildInput.metafile = input.metafile
  return {
    ...planWithoutOptions,
    buildOptions: toBunBuildOptions(buildInput),
  }
}

export function renderCompileEntrypoint(generatedFileName = 'liche.generated.ts'): string {
  const specifier = generatedModuleSpecifier(generatedFileName)
  return [
    '#!/usr/bin/env bun',
    `import { run } from '@liche/core'`,
    `import cli from ${JSON.stringify(specifier)}`,
    '',
    'await run(cli, process.argv.slice(2))',
    '',
  ].join('\n')
}

export async function compileEntrypoint(
  options: CreateCompilePlanInput,
  build: BunBuildFn = Bun.build,
): Promise<CompileEntrypointResult> {
  const plan = createCompilePlan(options)
  try {
    const output = await build(plan.buildOptions)
    if (!output.success) {
      return {
        ok: false,
        plan,
        logs: output.logs,
      }
    }
    return { ok: true, plan, build: output }
  } catch (error) {
    return {
      ok: false,
      plan,
      logs: [],
      // Normalize the caught value to a real Error at the boundary so consumers get a clean type and a
      // proper toString() (a non-Error throw can't degrade a hint to "[object Object]").
      error:
        error instanceof Error
          ? error
          : new Error(typeof error === 'string' ? error : (JSON.stringify(error) ?? 'Unknown build error')),
    }
  }
}

function toBunBuildOptions(input: {
  entrypoint: string
  outfile: string
  flags: CompileFlagProfile
  metafile?: CompileMetafile
}): BunBuildOptions {
  const options: BunBuildOptions = {
    entrypoints: [input.entrypoint],
    compile: {
      target: input.flags.target,
      outfile: input.outfile,
      autoloadBunfig: input.flags.autoload.bunfig,
      autoloadDotenv: input.flags.autoload.dotenv,
      autoloadPackageJson: input.flags.autoload.packageJson,
      autoloadTsconfig: input.flags.autoload.tsconfig,
    },
    minify: input.flags.minify,
    sourcemap: input.flags.sourcemap,
    bytecode: input.flags.bytecode,
    define: input.flags.define,
    packages: input.flags.packages,
    throw: false,
  }
  if (input.metafile !== undefined) options.metafile = input.metafile
  return options
}

function generatedModuleSpecifier(fileName: string): string {
  const jsFileName = fileName.replace(/\.(c|m)?tsx?$/, '.js')
  return `./${jsFileName}`
}
