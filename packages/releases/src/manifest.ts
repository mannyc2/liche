import { z } from 'zod'

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/)

const RepositoryMetadata = z.object({
  type: z.string(),
  url: z.string(),
})

const WindowsExecutableMetadata = z.object({
  hideConsole: z.boolean().default(false),
  iconSha256: Sha256.optional(),
})

const ExecutableMetadata = z.object({
  title: z.string().optional(),
  publisher: z.string().optional(),
  copyright: z.string().optional(),
  windows: WindowsExecutableMetadata.optional(),
})

const ReleaseMetadata = z.object({
  description: z.string(),
  homepage: z.url().optional(),
  license: z.string().optional(),
  repository: RepositoryMetadata.optional(),
  executable: ExecutableMetadata.optional(),
})

const SurfaceManifestReference = z.object({
  path: z.string(),
  sha256: Sha256,
})

const ProductProvenance = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  commit: z.string(),
  catalogDigest: z.string(),
  surfaceManifest: SurfaceManifestReference.optional(),
})

const ReleaseEnvelope = z.object({
  version: z.string(),
  channel: z.enum(['stable', 'next', 'canary']).default('stable'),
  createdAt: z.string(),
  generatorVersion: z.string(),
  buildId: z.string().optional(),
})

const RuntimeEnvVar = z.object({
  name: z.string(),
  purpose: z.string(),
  required: z.boolean().default(false),
})

const RuntimeConfigKey = z.object({
  key: z.string(),
  purpose: z.string(),
  required: z.boolean().default(false),
})

const RuntimeExpectations = z.object({
  command: z.string(),
  env: z.array(RuntimeEnvVar).default([]),
  config: z.array(RuntimeConfigKey).default([]),
})

const AuthEnvVar = z.object({
  name: z.string(),
  purpose: z.string(),
})

const AuthGeneratedCommands = z.object({
  login: z.string().optional(),
  logout: z.string().optional(),
  whoami: z.string().optional(),
  switch: z.string().optional(),
})

const AuthContext = z.object({
  id: z.string(),
  envVar: z.string().optional(),
  flag: z.string().optional(),
})

const AuthSessionStorage = z.object({
  used: z.boolean(),
  profiles: z.boolean(),
  storesAccessTokens: z.boolean(),
  storesRefreshTokens: z.boolean(),
  keychainRequired: z.boolean(),
})

const AuthProvider = z.object({
  id: z.string(),
  kind: z.enum(['none', 'bearer', 'apiKey', 'oauthDevice']),
  credentialTransport: z.enum(['none', 'bearer', 'apiKey']).optional(),
  modes: z.array(z.enum(['env', 'session', 'oauth-device'])).default([]),
  envVars: z.array(AuthEnvVar).default([]),
  commands: AuthGeneratedCommands.optional(),
  contexts: z.array(AuthContext).default([]),
  sessionStorage: AuthSessionStorage.optional(),
  requiredRuntimeCapabilities: z.array(z.string()).default([]),
})

const AuthSection = z.object({
  providers: z.array(AuthProvider).default([]),
})

const ConformanceSummary = z.object({
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
})

const ConformanceSection = z.object({
  required: z.boolean().default(false),
  report: z.string().optional(),
  reportVersion: z.number().int().positive().optional(),
  reportSha256: Sha256.optional(),
  checkedAt: z.string().optional(),
  targetEnv: z.string().optional(),
  targetBaseUrl: z.url().optional(),
  catalogDigest: z.string().optional(),
  destructiveIncluded: z.boolean().default(false),
  summary: ConformanceSummary.optional(),
})

const BinaryTarget = z.object({
  id: z.string(),
  target: z.string(),
  platform: z.enum(['darwin', 'linux', 'windows']),
  arch: z.enum(['arm64', 'x64']),
  libc: z.enum(['glibc', 'musl']).optional(),
  cpuVariant: z.enum(['baseline', 'modern']).optional(),
  filename: z.string(),
  url: z.url(),
  sha256: Sha256,
  size: z.number().int().positive(),
  compileFlagsDigest: z.string().optional(),
  signed: z.boolean().default(false),
  notarized: z.boolean().default(false),
})

const PackageArtifact = z.object({
  fileName: z.string(),
  url: z.url().optional(),
  sha256: Sha256,
  size: z.number().int().positive(),
})

const PackagePublishLocation = z.object({
  registry: z.string().optional(),
  repository: z.string().optional(),
  channel: z.string().optional(),
})

const PackageRecord = z.object({
  id: z.string(),
  renderer: z.enum(['npm', 'pypi', 'homebrew', 'scoop']),
  ecosystem: z.enum(['npm', 'pypi', 'homebrew', 'scoop']),
  kind: z.string(),
  name: z.string(),
  version: z.string(),
  targetBinaryId: z.string().optional(),
  artifact: PackageArtifact.optional(),
  publish: PackagePublishLocation.optional(),
})

export const CliReleaseManifestSchema = z.object({
  manifestVersion: z.literal(1),
  metadata: ReleaseMetadata,
  product: ProductProvenance,
  release: ReleaseEnvelope,
  runtime: RuntimeExpectations,
  auth: AuthSection.optional(),
  conformance: ConformanceSection.optional(),
  binaries: z.array(BinaryTarget),
  packages: z.array(PackageRecord).default([]),
})

export type CliReleaseManifest = z.infer<typeof CliReleaseManifestSchema>
export type CliReleaseManifestInput = z.input<typeof CliReleaseManifestSchema>

export type ReleaseMetadata = z.infer<typeof ReleaseMetadata>
export type ExecutableMetadata = z.infer<typeof ExecutableMetadata>
export type ProductProvenance = z.infer<typeof ProductProvenance>
export type ReleaseEnvelope = z.infer<typeof ReleaseEnvelope>
export type RuntimeExpectations = z.infer<typeof RuntimeExpectations>
export type RuntimeEnvVar = z.infer<typeof RuntimeEnvVar>
export type RuntimeConfigKey = z.infer<typeof RuntimeConfigKey>
export type AuthSection = z.infer<typeof AuthSection>
export type AuthProvider = z.infer<typeof AuthProvider>
export type AuthContext = z.infer<typeof AuthContext>
export type ConformanceSection = z.infer<typeof ConformanceSection>
export type BinaryTarget = z.infer<typeof BinaryTarget>
export type PackageRecord = z.infer<typeof PackageRecord>
export type PackageArtifact = z.infer<typeof PackageArtifact>

export type ParseManifestSuccess = { ok: true; manifest: CliReleaseManifest }
export type ParseManifestFailure = { ok: false; error: z.ZodError<CliReleaseManifest> }
export type ParseManifestResult = ParseManifestSuccess | ParseManifestFailure

export function parseCliReleaseManifest(input: unknown): ParseManifestResult {
  const result = CliReleaseManifestSchema.safeParse(input)
  if (result.success) return { ok: true, manifest: result.data }
  return { ok: false, error: result.error }
}
