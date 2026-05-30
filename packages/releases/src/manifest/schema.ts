import * as z from 'zod'

const Sha256 = z.hash('sha256')
const HttpUrl = z.httpUrl()
const DefaultFalse = z.boolean().default(false)
const ReleaseChannel = z.enum(['stable', 'next', 'canary'])
const AuthProviderKind = z.enum(['none', 'bearer', 'apiKey', 'oauthDevice'])
const CredentialTransport = z.enum(['none', 'bearer', 'apiKey'])
const AuthMode = z.enum(['env', 'session', 'oauth-device'])
const BinaryPlatform = z.enum(['darwin', 'linux', 'windows'])
const BinaryArch = z.enum(['arm64', 'x64'])
const LinuxLibc = z.enum(['glibc', 'musl'])
const CpuVariant = z.enum(['baseline', 'modern'])
const PackageEcosystem = z.enum(['npm', 'pypi', 'homebrew', 'scoop'])

const RepositoryMetadataSchema = z.object({
  type: z.string(),
  url: z.string(),
})

const WindowsExecutableMetadataSchema = z.object({
  hideConsole: DefaultFalse,
  iconSha256: Sha256.optional(),
})

const ExecutableMetadataSchema = z.object({
  title: z.string().optional(),
  publisher: z.string().optional(),
  copyright: z.string().optional(),
  windows: WindowsExecutableMetadataSchema.optional(),
})

const ReleaseMetadataSchema = z.object({
  description: z.string(),
  homepage: HttpUrl.optional(),
  license: z.string().optional(),
  repository: RepositoryMetadataSchema.optional(),
  executable: ExecutableMetadataSchema.optional(),
})

const SurfaceManifestReferenceSchema = z.object({
  path: z.string(),
  sha256: Sha256,
})

const ProductContractProvenanceSchema = z.object({
  kind: z.literal('product-catalog'),
  digest: z.string(),
  surfaceManifest: SurfaceManifestReferenceSchema.optional(),
})

const CoreContractProvenanceSchema = z.object({
  kind: z.literal('core-command-manifest'),
  digest: z.string(),
  commandManifest: SurfaceManifestReferenceSchema.optional(),
})

const ContractProvenanceSchema = z.discriminatedUnion('kind', [
  ProductContractProvenanceSchema,
  CoreContractProvenanceSchema,
])

const ReleaseSubjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  commit: z.string(),
  contract: ContractProvenanceSchema,
})

const ReleaseEnvelopeSchema = z.object({
  version: z.string(),
  channel: ReleaseChannel.default('stable'),
  createdAt: z.string(),
  generatorVersion: z.string(),
  buildId: z.string().optional(),
})

const RuntimeEnvVarSchema = z.object({
  name: z.string(),
  purpose: z.string(),
  required: DefaultFalse,
})

const RuntimeConfigKeySchema = z.object({
  key: z.string(),
  purpose: z.string(),
  required: DefaultFalse,
})

const RuntimeExpectationsSchema = z.object({
  command: z.string(),
  env: z.array(RuntimeEnvVarSchema).default([]),
  config: z.array(RuntimeConfigKeySchema).default([]),
})

const AuthEnvVarSchema = z.object({
  name: z.string(),
  purpose: z.string(),
})

const AuthGeneratedCommandsSchema = z.object({
  login: z.string().optional(),
  logout: z.string().optional(),
  whoami: z.string().optional(),
  switch: z.string().optional(),
})

const AuthContextSchema = z.object({
  id: z.string(),
  envVar: z.string().optional(),
  flag: z.string().optional(),
})

const AuthSessionStorageSchema = z.object({
  used: z.boolean(),
  profiles: z.boolean(),
  storesAccessTokens: z.boolean(),
  storesRefreshTokens: z.boolean(),
  keychainRequired: z.boolean(),
})

const AuthProviderSchema = z.object({
  id: z.string(),
  kind: AuthProviderKind,
  credentialTransport: CredentialTransport.optional(),
  modes: z.array(AuthMode).default([]),
  envVars: z.array(AuthEnvVarSchema).default([]),
  commands: AuthGeneratedCommandsSchema.optional(),
  contexts: z.array(AuthContextSchema).default([]),
  sessionStorage: AuthSessionStorageSchema.optional(),
  requiredRuntimeCapabilities: z.array(z.string()).default([]),
})

const AuthSectionSchema = z.object({
  providers: z.array(AuthProviderSchema).default([]),
})

const ConformanceSummarySchema = z.object({
  passed: z.int().nonnegative(),
  failed: z.int().nonnegative(),
  skipped: z.int().nonnegative(),
  total: z.int().nonnegative(),
})

const ConformanceSectionSchema = z.object({
  required: DefaultFalse,
  report: z.string().optional(),
  reportVersion: z.int().positive().optional(),
  reportSha256: Sha256.optional(),
  checkedAt: z.string().optional(),
  targetEnv: z.string().optional(),
  targetBaseUrl: HttpUrl.optional(),
  contractDigest: z.string().optional(),
  destructiveIncluded: DefaultFalse,
  summary: ConformanceSummarySchema.optional(),
})

const BinaryTargetSchema = z.object({
  id: z.string(),
  target: z.string(),
  platform: BinaryPlatform,
  arch: BinaryArch,
  libc: LinuxLibc.optional(),
  cpuVariant: CpuVariant.optional(),
  filename: z.string(),
  url: HttpUrl,
  sha256: Sha256,
  size: z.int().positive(),
  compileFlagsDigest: z.string().optional(),
  signed: DefaultFalse,
  notarized: DefaultFalse,
})

const PackageArtifactSchema = z.object({
  fileName: z.string(),
  url: HttpUrl.optional(),
  sha256: Sha256,
  size: z.int().positive(),
})

const PackagePublishLocationSchema = z.object({
  registry: z.string().optional(),
  repository: z.string().optional(),
  channel: z.string().optional(),
})

const PackageRecordSchema = z.object({
  id: z.string(),
  renderer: PackageEcosystem,
  ecosystem: PackageEcosystem,
  kind: z.string(),
  name: z.string(),
  version: z.string(),
  targetBinaryId: z.string().optional(),
  artifact: PackageArtifactSchema.optional(),
  publish: PackagePublishLocationSchema.optional(),
})

export const CliReleaseManifestSchema = z.object({
  manifestVersion: z.literal(1),
  metadata: ReleaseMetadataSchema,
  subject: ReleaseSubjectSchema,
  release: ReleaseEnvelopeSchema,
  runtime: RuntimeExpectationsSchema,
  auth: AuthSectionSchema.optional(),
  conformance: ConformanceSectionSchema.optional(),
  binaries: z.array(BinaryTargetSchema),
  packages: z.array(PackageRecordSchema).default([]),
})

export type CliReleaseManifest = z.infer<typeof CliReleaseManifestSchema>
export type CliReleaseManifestInput = z.input<typeof CliReleaseManifestSchema>

export type ReleaseMetadata = z.infer<typeof ReleaseMetadataSchema>
export type ExecutableMetadata = z.infer<typeof ExecutableMetadataSchema>
export type ContractProvenance = z.infer<typeof ContractProvenanceSchema>
export type ReleaseSubject = z.infer<typeof ReleaseSubjectSchema>
export type ReleaseEnvelope = z.infer<typeof ReleaseEnvelopeSchema>
export type RuntimeExpectations = z.infer<typeof RuntimeExpectationsSchema>
export type RuntimeEnvVar = z.infer<typeof RuntimeEnvVarSchema>
export type RuntimeConfigKey = z.infer<typeof RuntimeConfigKeySchema>
export type AuthSection = z.infer<typeof AuthSectionSchema>
export type AuthProvider = z.infer<typeof AuthProviderSchema>
export type AuthContext = z.infer<typeof AuthContextSchema>
export type ConformanceSection = z.infer<typeof ConformanceSectionSchema>
export type BinaryTarget = z.infer<typeof BinaryTargetSchema>
export type PackageEcosystem = z.infer<typeof PackageEcosystem>
export type PackageRecord = z.infer<typeof PackageRecordSchema>
export type PackageArtifact = z.infer<typeof PackageArtifactSchema>

export type ParseManifestSuccess = { ok: true; manifest: CliReleaseManifest }
export type ParseManifestFailure = { ok: false; error: z.ZodError<CliReleaseManifest> }
export type ParseManifestResult = ParseManifestSuccess | ParseManifestFailure

export function parseCliReleaseManifest(input: unknown): ParseManifestResult {
  const result = CliReleaseManifestSchema.safeParse(input)
  if (result.success) return { ok: true, manifest: result.data }
  return { ok: false, error: result.error }
}
