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
    | 'LILI_BUILD_VERSION'
    | 'LILI_CONTRACT_DIGEST'
    | 'LILI_SOURCE_COMMIT'
    | 'LILI_BUILD_TOOL_VERSION',
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
  error?: unknown
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
      LILI_BUILD_VERSION: JSON.stringify(input.constants.releaseVersion),
      LILI_CONTRACT_DIGEST: JSON.stringify(input.constants.contractDigest),
      LILI_SOURCE_COMMIT: JSON.stringify(input.constants.sourceCommit),
      LILI_BUILD_TOOL_VERSION: JSON.stringify(input.constants.buildToolVersion),
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

export function renderCompileEntrypoint(generatedFileName = 'lili.generated.ts'): string {
  const specifier = generatedModuleSpecifier(generatedFileName)
  return [
    '#!/usr/bin/env bun',
    `import cli from ${JSON.stringify(specifier)}`,
    '',
    'await cli.serve(process.argv.slice(2))',
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
      error,
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
