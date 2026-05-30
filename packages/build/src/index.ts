export { canonicalDigest, canonicalize } from './digest.js'

export {
  compileEntrypoint,
  compileFlagsDigest,
  createCompileFlagProfile,
  createCompilePlan,
  renderCompileEntrypoint,
} from './compile.js'
export type {
  BunBuildFn,
  CompileConstants,
  CompileEntrypointFailure,
  CompileEntrypointResult,
  CompileEntrypointSuccess,
  CompileFlagProfile,
  CompileMetafile,
  CompilePlan,
  CompileTarget,
  CreateCompilePlanInput,
} from './compile.js'

export { TARGETS, TARGET_PRESETS, isTargetPreset, resolveTargets } from './targets.js'
export type {
  ResolveTargetsFailure,
  ResolveTargetsFailureCode,
  ResolveTargetsResult,
  TargetArch,
  TargetCpuVariant,
  TargetDescriptor,
  TargetLibc,
  TargetPlatform,
  TargetPreset,
  TargetSelection,
} from './targets.js'

export { buildBinaries } from './build.js'
export type { BuildBinariesInput, BuildBinariesResult, BuildFailure, BuildFailureCode } from './build.js'

export { BuildRecordSchema, parseBuildRecord } from './build-record.js'
export type {
  BuildRecord,
  ParseBuildRecordFailure,
  ParseBuildRecordResult,
  ParseBuildRecordSuccess,
  RecordedBinary,
} from './build-record.js'
