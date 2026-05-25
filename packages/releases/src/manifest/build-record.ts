import { z } from 'zod'

// This schema mirrors the BuildRecord shape emitted by the build package
// (liche-build build --record). We keep a local copy so this package stays
// consumable standalone; both schemas must stay in sync — any new field on
// the build side must land here too.

const Sha256 = z.hash('sha256')

const RecordedBinarySchema = z.object({
  id: z.string(),
  target: z.string(),
  platform: z.enum(['darwin', 'linux', 'windows']),
  arch: z.enum(['arm64', 'x64']),
  libc: z.enum(['glibc', 'musl']).optional(),
  cpuVariant: z.enum(['baseline', 'modern']).optional(),
  path: z.string(),
  filename: z.string(),
  sha256: Sha256,
  size: z.int().positive(),
  compileFlagsDigest: z.string(),
})

export const BuildRecordSchema = z.object({
  recordVersion: z.literal(1),
  entrypoint: z.string(),
  constants: z.object({
    releaseVersion: z.string(),
    contractDigest: z.string(),
    sourceCommit: z.string(),
    buildToolVersion: z.string(),
  }),
  binaries: z.array(RecordedBinarySchema),
})

export type BuildRecord = z.infer<typeof BuildRecordSchema>
export type RecordedBinary = z.infer<typeof RecordedBinarySchema>

export type ParseBuildRecordSuccess = { ok: true; record: BuildRecord }
export type ParseBuildRecordFailure = { ok: false; error: z.ZodError<BuildRecord> }
export type ParseBuildRecordResult = ParseBuildRecordSuccess | ParseBuildRecordFailure

export function parseBuildRecord(value: unknown): ParseBuildRecordResult {
  const parsed = BuildRecordSchema.safeParse(value)
  if (parsed.success) return { ok: true, record: parsed.data }
  return { ok: false, error: parsed.error }
}
