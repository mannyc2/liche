import type { CompileTarget } from './compile.js'

export type TargetPlatform = 'darwin' | 'linux' | 'windows'
export type TargetArch = 'arm64' | 'x64'
export type TargetLibc = 'glibc' | 'musl'
export type TargetCpuVariant = 'baseline' | 'modern'

export type TargetDescriptor = {
  id: string
  target: CompileTarget
  platform: TargetPlatform
  arch: TargetArch
  libc?: TargetLibc
  cpuVariant?: TargetCpuVariant
  ext: '' | '.exe'
}

// Curated subset of Bun's supported targets. Baseline CPU variants are
// reachable via Targets.list(['linux-x64-baseline', ...]); they're not in
// any preset to keep `all` predictable for typical consumers.
export const TARGETS: Record<string, TargetDescriptor> = {
  'darwin-arm64':       { id: 'darwin-arm64',       target: 'bun-darwin-arm64' as CompileTarget,       platform: 'darwin',  arch: 'arm64', ext: '' },
  'darwin-x64':         { id: 'darwin-x64',         target: 'bun-darwin-x64' as CompileTarget,         platform: 'darwin',  arch: 'x64',   ext: '' },
  'darwin-x64-baseline':{ id: 'darwin-x64-baseline',target: 'bun-darwin-x64-baseline' as CompileTarget,platform: 'darwin',  arch: 'x64',   cpuVariant: 'baseline', ext: '' },
  'linux-arm64':        { id: 'linux-arm64',        target: 'bun-linux-arm64' as CompileTarget,        platform: 'linux',   arch: 'arm64', libc: 'glibc', ext: '' },
  'linux-arm64-musl':   { id: 'linux-arm64-musl',   target: 'bun-linux-arm64-musl' as CompileTarget,   platform: 'linux',   arch: 'arm64', libc: 'musl',  ext: '' },
  'linux-x64':          { id: 'linux-x64',          target: 'bun-linux-x64' as CompileTarget,          platform: 'linux',   arch: 'x64',   libc: 'glibc', ext: '' },
  'linux-x64-baseline': { id: 'linux-x64-baseline', target: 'bun-linux-x64-baseline' as CompileTarget, platform: 'linux',   arch: 'x64',   libc: 'glibc', cpuVariant: 'baseline', ext: '' },
  'linux-x64-musl':     { id: 'linux-x64-musl',     target: 'bun-linux-x64-musl' as CompileTarget,     platform: 'linux',   arch: 'x64',   libc: 'musl',  ext: '' },
  'linux-x64-musl-baseline': { id: 'linux-x64-musl-baseline', target: 'bun-linux-x64-musl-baseline' as CompileTarget, platform: 'linux', arch: 'x64', libc: 'musl', cpuVariant: 'baseline', ext: '' },
  'windows-x64':        { id: 'windows-x64',        target: 'bun-windows-x64' as CompileTarget,        platform: 'windows', arch: 'x64',   ext: '.exe' },
  'windows-x64-baseline': { id: 'windows-x64-baseline', target: 'bun-windows-x64-baseline' as CompileTarget, platform: 'windows', arch: 'x64', cpuVariant: 'baseline', ext: '.exe' },
}

export const TARGET_PRESETS = {
  all: [
    'darwin-arm64',
    'darwin-x64',
    'linux-arm64',
    'linux-arm64-musl',
    'linux-x64',
    'linux-x64-musl',
    'windows-x64',
  ],
  npm: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'windows-x64'],
  homebrew: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'],
  scoop: ['windows-x64'],
  unix: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'],
  'darwin-only': ['darwin-arm64', 'darwin-x64'],
  'linux-only': ['linux-arm64', 'linux-arm64-musl', 'linux-x64', 'linux-x64-musl'],
  'windows-only': ['windows-x64'],
} as const

export type TargetPreset = keyof typeof TARGET_PRESETS
export type TargetSelection = TargetPreset | readonly string[]

export type ResolveTargetsFailureCode = 'TARGET_UNKNOWN' | 'TARGET_PRESET_EMPTY' | 'TARGET_DUPLICATE'

export type ResolveTargetsFailure = {
  code: ResolveTargetsFailureCode
  message: string
  details?: Record<string, unknown>
}

export type ResolveTargetsResult =
  | { ok: true; targets: TargetDescriptor[] }
  | { ok: false; failures: ResolveTargetsFailure[] }

export function isTargetPreset(value: string): value is TargetPreset {
  return value in TARGET_PRESETS
}

function selectionIds(selection: TargetSelection): readonly string[] {
  if (typeof selection === 'string') return TARGET_PRESETS[selection]
  return selection
}

export function resolveTargets(selection: TargetSelection): ResolveTargetsResult {
  const ids = selectionIds(selection)
  if (ids.length === 0) {
    return {
      ok: false,
      failures: [
        {
          code: 'TARGET_PRESET_EMPTY',
          message: 'target selection resolved to an empty list',
        },
      ],
    }
  }
  const seen = new Set<string>()
  const failures: ResolveTargetsFailure[] = []
  const targets: TargetDescriptor[] = []
  for (const id of ids) {
    if (seen.has(id)) {
      failures.push({
        code: 'TARGET_DUPLICATE',
        message: `target '${id}' appeared more than once in the selection`,
        details: { id },
      })
      continue
    }
    seen.add(id)
    const descriptor = TARGETS[id]
    if (!descriptor) {
      failures.push({
        code: 'TARGET_UNKNOWN',
        message: `target '${id}' is not a known Bun compile target`,
        details: { id },
      })
      continue
    }
    targets.push(descriptor)
  }
  if (failures.length > 0) return { ok: false, failures }
  return { ok: true, targets }
}
