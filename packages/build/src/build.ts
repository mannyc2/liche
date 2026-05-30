import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { BunBuildFn, CompileConstants, CompileEntrypointResult } from './compile.js'
import { compileEntrypoint } from './compile.js'
import type { RecordedBinary, BuildRecord } from './build-record.js'
import { resolveTargets } from './targets.js'
import type { ResolveTargetsFailure, TargetDescriptor, TargetSelection } from './targets.js'

export type BuildBinariesInput = {
  entrypoint: string
  targets: TargetSelection
  constants: CompileConstants
  outDir: string
  filename?: string
  parallel?: boolean
  buildFn?: BunBuildFn
}

export type BuildFailureCode = 'TARGET_RESOLUTION_FAILED' | 'COMPILE_FAILED' | 'BINARY_READ_FAILED'

export type BuildFailure = {
  targetId: string | null
  code: BuildFailureCode
  message: string
  details?: Record<string, unknown>
}

export type BuildBinariesResult =
  | { ok: true; record: BuildRecord }
  | { ok: false; failures: BuildFailure[]; record: BuildRecord }

function defaultFilename(input: BuildBinariesInput): string {
  return input.filename ?? 'cli'
}

function outfileFor(input: BuildBinariesInput, target: TargetDescriptor): string {
  return join(input.outDir, target.id, `${defaultFilename(input)}${target.ext}`)
}

function targetResolutionFailures(failures: readonly ResolveTargetsFailure[]): BuildFailure[] {
  return failures.map((failure) => {
    const result: BuildFailure = {
      targetId: typeof failure.details?.['id'] === 'string' ? failure.details['id'] : null,
      code: 'TARGET_RESOLUTION_FAILED',
      message: failure.message,
    }
    if (failure.details) result.details = { ...failure.details, originalCode: failure.code }
    else result.details = { originalCode: failure.code }
    return result
  })
}

async function readBinary(path: string): Promise<{ sha256: string; size: number } | null> {
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    const bytes = new Uint8Array(await file.arrayBuffer())
    return {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength,
    }
  } catch {
    return null
  }
}

async function compileOneTarget(
  input: BuildBinariesInput,
  target: TargetDescriptor,
): Promise<{ ok: true; binary: RecordedBinary } | { ok: false; failure: BuildFailure }> {
  const outfile = outfileFor(input, target)
  await mkdir(join(input.outDir, target.id), { recursive: true })

  const result: CompileEntrypointResult = await compileEntrypoint(
    {
      entrypoint: input.entrypoint,
      outfile,
      target: target.target,
      constants: input.constants,
    },
    input.buildFn,
  )

  if (!result.ok) {
    const hint =
      result.logs.length > 0
        ? result.logs.map((entry) => String(entry)).join('\n')
        : result.error === undefined
          ? ''
          : String(result.error)
    const failure: BuildFailure = {
      targetId: target.id,
      code: 'COMPILE_FAILED',
      message: `compile failed for target '${target.id}'`,
    }
    if (hint.length > 0) failure.details = { logs: hint }
    return { ok: false, failure }
  }

  const hashed = await readBinary(outfile)
  if (!hashed) {
    return {
      ok: false,
      failure: {
        targetId: target.id,
        code: 'BINARY_READ_FAILED',
        message: `could not read compiled binary for target '${target.id}' from '${outfile}'`,
        details: { path: outfile },
      },
    }
  }

  const binary: RecordedBinary = {
    id: target.id,
    target: target.target,
    platform: target.platform,
    arch: target.arch,
    path: outfile,
    filename: `${defaultFilename(input)}${target.ext}`,
    sha256: hashed.sha256,
    size: hashed.size,
    compileFlagsDigest: result.plan.compileFlagsDigest,
  }
  if (target.libc) binary.libc = target.libc
  if (target.cpuVariant) binary.cpuVariant = target.cpuVariant
  return { ok: true, binary }
}

export async function buildBinaries(input: BuildBinariesInput): Promise<BuildBinariesResult> {
  const resolved = resolveTargets(input.targets)
  if (!resolved.ok) {
    return {
      ok: false,
      failures: targetResolutionFailures(resolved.failures),
      record: {
        recordVersion: 1,
        entrypoint: input.entrypoint,
        constants: input.constants,
        binaries: [],
      },
    }
  }

  await mkdir(input.outDir, { recursive: true })

  const parallel = input.parallel ?? true
  const outcomes: Array<{ ok: true; binary: RecordedBinary } | { ok: false; failure: BuildFailure }> = []

  if (parallel) {
    outcomes.push(...(await Promise.all(resolved.targets.map((target) => compileOneTarget(input, target)))))
  } else {
    for (const target of resolved.targets) {
      outcomes.push(await compileOneTarget(input, target))
    }
  }

  const binaries: RecordedBinary[] = []
  const failures: BuildFailure[] = []
  for (const outcome of outcomes) {
    if (outcome.ok) binaries.push(outcome.binary)
    else failures.push(outcome.failure)
  }

  const record: BuildRecord = {
    recordVersion: 1,
    entrypoint: input.entrypoint,
    constants: input.constants,
    binaries,
  }

  if (failures.length > 0) return { ok: false, failures, record }
  return { ok: true, record }
}
