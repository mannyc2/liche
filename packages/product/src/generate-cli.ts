import { resolveListShape } from './catalog.js'
import type {
  Capability,
  Catalog,
  CommandCapability,
  NormalizedAuth,
  NormalizedCapabilityExample,
  NormalizedContext,
  NormalizedEffects,
  NormalizedHttpBind,
  NormalizedPermission,
  NormalizedPolicy,
  NormalizedRuntimeValue,
  NormalizedShape,
  NormalizedObjectShape,
  ResourceOperationCapability,
} from './catalog.js'
import type { JsonSchemaNode } from './types.js'

function needsAuthResolution(cap: Capability): boolean {
  return cap.requires.auth === true
}

function neededContexts(cap: Capability): string[] {
  return [...cap.requires.contexts]
}

function authRuntimeUsed(catalog: Catalog): boolean {
  if (catalog.auth.kind === 'none') return false
  return catalog.capabilities.some((cap) => needsAuthResolution(cap) || (cap.kind === 'command' && cap.family === 'auth'))
}

function contextRuntimeUsed(catalog: Catalog): boolean {
  return catalog.capabilities.some((c) => c.requires.contexts.length > 0)
}

function opsRuntimeUsed(catalog: Catalog): boolean {
  return catalog.ops.enabled && (catalog.ops.doctor !== false || catalog.ops.telemetry !== false)
}

function capabilityHasAuthMetadata(cap: Capability): boolean {
  return cap.requires.auth || cap.requires.contexts.length > 0 || cap.requires.permissions.length > 0
}

export type GenerateOptions = {
  generatorVersion: string
  canonicalIrDigest: string
  generationOptionsDigest: string
  surfaceId?: string
}

export function generateCli(catalog: Catalog, options: GenerateOptions): string {
  assertRemoteTransportReady(catalog)
  const lines: string[] = []
  lines.push(...renderHeader(catalog, options))
  lines.push('')
  lines.push(...renderImports(catalog))
  if (authRuntimeUsed(catalog) || contextRuntimeUsed(catalog) || opsRuntimeUsed(catalog)) {
    lines.push('')
    lines.push(...renderRuntimeConstants(catalog))
  }
  if (catalog.ops.enabled) {
    lines.push('')
    lines.push(...renderCatalogConstants(catalog))
    if (catalog.ops.doctor !== false) {
      lines.push('')
      lines.push(...renderProductDoctorHelpers())
    }
  }
  lines.push('')
  lines.push(...renderCli(catalog))
  lines.push('')
  return lines.join('\n')
}

function assertRemoteTransportReady(catalog: Catalog): void {
  for (const cap of catalog.capabilities) {
    if (cap.kind === 'resource-operation') {
      if (!cap.http) {
        throw new Error(
          `Generated CLI cannot render resource operation '${cap.id}' because it has no HTTP transport.`,
        )
      }
      if (!catalog.remote) throw missingRemoteError(cap.id)
      continue
    }
    if (cap.execution.mode === 'remote-http' && !catalog.remote) throw missingRemoteError(cap.id)
  }
}

function missingRemoteError(capabilityId: string): Error {
  return new Error(
    `Generated CLI cannot render HTTP capability '${capabilityId}' without defineProduct({ remote: { baseUrl } }).`,
  )
}

function renderRuntimeConstants(catalog: Catalog): string[] {
  const lines: string[] = []
  if (authRuntimeUsed(catalog) || opsRuntimeUsed(catalog)) {
    lines.push(`const PRODUCT_ID = ${q(catalog.product.id)}`)
  }
  if (authRuntimeUsed(catalog) && catalog.auth.kind !== 'none') {
    lines.push(`const PROFILE_ENV_VAR = ${q(profileEnvVar(catalog.product.id))}`)
    lines.push(`const AUTH_PROVIDER = ${renderAuth(catalog.auth)} as const`)
  }
  if (contextRuntimeUsed(catalog) && catalog.contexts.length > 0) {
    lines.push(`const CONTEXTS = ${renderContexts(catalog.contexts)} as const`)
  }
  if (catalog.ops.doctor !== false) {
    lines.push(`const DOCTOR_PACKAGE_MANAGERS = ${renderStringArray(catalog.ops.doctor.packageManagers)} as const`)
  }
  if (catalog.ops.telemetry !== false) {
    lines.push(`const TELEMETRY_ENABLED_ENV_VAR = ${q(catalog.ops.telemetry.enabledEnvVar)}`)
    lines.push(`const TELEMETRY_FILE_ENV_VAR = ${q(catalog.ops.telemetry.fileEnvVar)}`)
  }
  return lines
}

function renderCatalogConstants(catalog: Catalog): string[] {
  return [
    `const GENERATED_CATALOG = ${JSON.stringify(catalog, null, 2)} as const`,
    `const STATIC_NOTICES = ${JSON.stringify(catalog.ops.notices, null, 2)} as const`,
    `const STATIC_RELEASE = ${JSON.stringify(catalog.ops.release, null, 2)} as const`,
  ]
}

function renderProductDoctorHelpers(): string[] {
  return [
    `type GeneratedPackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn'`,
    ``,
    `type GeneratedDoctorCheck = {`,
    `  id: string`,
    `  status: 'pass' | 'warn' | 'fail'`,
    `  message: string`,
    `  details?: Record<string, unknown> | undefined`,
    `}`,
    ``,
    `type GeneratedLocalDoctorInput = {`,
    `  cliName: string`,
    `  version?: string | undefined`,
    `  env: Record<string, string | undefined>`,
    `  packageManagers: readonly GeneratedPackageManager[]`,
    `}`,
    ``,
    `type GeneratedDoctorContext = {`,
    `  config: Record<string, unknown>`,
    `  env: Record<string, string | undefined>`,
    `  sources: { config(path: string): { kind: string } }`,
    `}`,
    ``,
    `async function runGeneratedLocalDoctor(input: GeneratedLocalDoctorInput): Promise<{ cli: { name: string; version?: string | undefined }; checks: GeneratedDoctorCheck[]; summary: { pass: number; warn: number; fail: number } }> {`,
    `  const checks: GeneratedDoctorCheck[] = []`,
    `  const pathEntries = splitGeneratedPath(input.env.PATH)`,
    `  checks.push(pathEntries.length > 0`,
    `    ? {`,
    `        id: 'path.present',`,
    `        status: 'pass',`,
    `        message: 'PATH is configured.',`,
    `        details: { entries: pathEntries.length },`,
    `      }`,
    `    : {`,
    `        id: 'path.present',`,
    `        status: 'fail',`,
    `        message: 'PATH is empty or missing.',`,
    `      })`,
    `  checks.push(pathEntries.some(isGeneratedLocalBinPath)`,
    `    ? {`,
    `        id: 'path.local-bin',`,
    `        status: 'pass',`,
    `        message: 'PATH includes a local node_modules/.bin entry.',`,
    `      }`,
    `    : {`,
    `        id: 'path.local-bin',`,
    `        status: 'warn',`,
    `        message: 'PATH does not include a local node_modules/.bin entry.',`,
    `      })`,
    `  for (const manager of input.packageManagers) {`,
    `    const found = Bun.which(manager, { PATH: pathEntries.join(generatedPathDelimiter()) })`,
    `    checks.push(found`,
    `      ? {`,
    `          id: ${'`package-manager.${manager}`'},`,
    `          status: 'pass',`,
    `          message: ${'`${manager} is available on PATH.`'},`,
    `          details: { path: found },`,
    `        }`,
    `      : {`,
    `          id: ${'`package-manager.${manager}`'},`,
    `          status: manager === 'bun' ? 'fail' : 'warn',`,
    `          message: ${'`${manager} was not found on PATH.`'},`,
    `        })`,
    `  }`,
    `  return {`,
    `    cli: input.version === undefined ? { name: input.cliName } : { name: input.cliName, version: input.version },`,
    `    checks,`,
    `    summary: countGeneratedDoctorChecks(checks),`,
    `  }`,
    `}`,
    ``,
    `function splitGeneratedPath(value: string | undefined): string[] {`,
    `  return (value ?? '').split(generatedPathDelimiter()).map((entry) => entry.trim()).filter(Boolean)`,
    `}`,
    ``,
    `function generatedPathDelimiter(): string {`,
    `  return process.platform === 'win32' ? ';' : ':'`,
    `}`,
    ``,
    `function isGeneratedLocalBinPath(path: string): boolean {`,
    `  return path.endsWith('node_modules/.bin') || path.endsWith('node_modules\\\\.bin') || path.includes('node_modules/.bin')`,
    `}`,
    ``,
    `function withGeneratedProductDoctor(ctx: GeneratedDoctorContext, local: { cli: unknown; checks: GeneratedDoctorCheck[] }): { cli: unknown; checks: GeneratedDoctorCheck[]; summary: { pass: number; warn: number; fail: number } } {`,
    `  const checks: GeneratedDoctorCheck[] = [...local.checks, ...generatedProductDoctorChecks(ctx)]`,
    `  return { cli: local.cli, checks, summary: countGeneratedDoctorChecks(checks) }`,
    `}`,
    ``,
    `function generatedProductDoctorChecks(ctx: GeneratedDoctorContext): GeneratedDoctorCheck[] {`,
    `  const catalog = GENERATED_CATALOG as any`,
    `  const checks: GeneratedDoctorCheck[] = []`,
    `  checks.push({`,
    `    id: 'product.catalog',`,
    `    status: 'pass',`,
    `    message: 'Generated product catalog is embedded.',`,
    `    details: { productId: catalog.product?.id, version: catalog.product?.version, capabilities: Array.isArray(catalog.capabilities) ? catalog.capabilities.length : 0 },`,
    `  })`,
    `  if (catalog.config) {`,
    `    const properties = catalog.config.fields?.properties ?? {}`,
    `    checks.push({`,
    `      id: 'product.config',`,
    `      status: 'pass',`,
    `      message: 'Product config schema is available to the generated CLI.',`,
    `      details: { files: catalog.config.files ?? [], fields: Object.keys(properties).sort() },`,
    `    })`,
    `  } else {`,
    `    checks.push({ id: 'product.config', status: 'pass', message: 'No durable product config is declared.' })`,
    `  }`,
    `  checks.push(generatedRemoteBaseUrlCheck(ctx, catalog.remote?.baseUrl))`,
    `  checks.push(...generatedAuthChecks(ctx, catalog.auth))`,
    `  checks.push(...generatedContextChecks(ctx, catalog.contexts ?? []))`,
    `  checks.push(generatedAgentReadinessCheck(catalog.capabilities ?? []))`,
    `  checks.push(...generatedNoticeChecks(catalog.ops?.notices ?? { updates: [], channels: [], yanks: [] }))`,
    `  checks.push(...generatedReleaseChecks(catalog.ops?.release ?? false))`,
    `  return checks`,
    `}`,
    ``,
    `function generatedRemoteBaseUrlCheck(ctx: GeneratedDoctorContext, source: any): GeneratedDoctorCheck {`,
    `  if (!source) return { id: 'remote.base-url', status: 'pass', message: 'No remote base URL is required.' }`,
    `  if (source.kind === 'literal') {`,
    `    return { id: 'remote.base-url', status: 'pass', message: 'Remote base URL is declared as a literal.', details: { source: 'schema-default' } }`,
    `  }`,
    `  if (source.kind === 'env') {`,
    `    const value = ctx.env[source.envVar]`,
    `    const hasEnv = typeof value === 'string' && value.length > 0`,
    `    const hasFallback = typeof source.fallback === 'string' && source.fallback.length > 0`,
    `    return {`,
    `      id: 'remote.base-url',`,
    `      status: hasEnv || hasFallback ? 'pass' : 'fail',`,
    `      message: hasEnv ? 'Remote base URL env var is set.' : hasFallback ? 'Remote base URL env var is missing; literal fallback will be used.' : 'Remote base URL env var is missing.',`,
    `      details: { envVar: source.envVar, source: hasEnv ? 'env' : hasFallback ? 'schema-default' : 'missing' },`,
    `    }`,
    `  }`,
    `  if (source.kind === 'config') {`,
    `    const value = ctx.config[source.path]`,
    `    const ok = typeof value === 'string' && value.length > 0`,
    `    return {`,
    `      id: 'remote.base-url',`,
    `      status: ok ? 'pass' : 'fail',`,
    `      message: ok ? 'Remote base URL config value is resolved.' : 'Remote base URL config value is missing.',`,
    `      details: { configPath: source.path, source: ok ? generatedConfigSourceKind(ctx.sources.config(source.path).kind) : 'missing' },`,
    `    }`,
    `  }`,
    `  return { id: 'remote.base-url', status: 'fail', message: 'Remote base URL declaration is not recognized.' }`,
    `}`,
    ``,
    `function generatedConfigSourceKind(kind: string): string {`,
    `  return kind === 'default' ? 'schema-default' : 'config'`,
    `}`,
    ``,
    `function generatedAuthChecks(ctx: GeneratedDoctorContext, auth: any): GeneratedDoctorCheck[] {`,
    `  if (!auth || auth.kind === 'none') {`,
    `    return [{ id: 'auth.provider', status: 'pass', message: 'No auth provider is declared.' }]`,
    `  }`,
    `  const checks: GeneratedDoctorCheck[] = [{`,
    `    id: 'auth.provider',`,
    `    status: 'pass',`,
    `    message: 'Auth provider metadata is embedded without secrets.',`,
    `    details: { providerId: auth.id, kind: auth.kind },`,
    `  }]`,
    `  for (const source of auth.tokenSources ?? []) {`,
    `    if (source.kind === 'env') {`,
    `      const set = typeof ctx.env[source.envVar] === 'string' && ctx.env[source.envVar]!.length > 0`,
    `      checks.push({`,
    `        id: ${'`auth.env.${source.envVar}`'},`,
    `        status: set ? 'pass' : source.mode === 'ci' ? 'warn' : 'fail',`,
    `        message: set ? 'Auth env var is set.' : 'Auth env var is missing.',`,
    `        details: { envVar: source.envVar, mode: source.mode },`,
    `      })`,
    `    } else if (source.kind === 'session') {`,
    `      checks.push({`,
    `        id: 'auth.session-store',`,
    `        status: 'pass',`,
    `        message: 'File-backed auth sessions are enabled.',`,
    `        details: { profiles: source.profiles === true, refresh: source.refresh === true },`,
    `      })`,
    `    }`,
    `  }`,
    `  return checks`,
    `}`,
    ``,
    `function generatedContextChecks(ctx: GeneratedDoctorContext, contexts: readonly any[]): GeneratedDoctorCheck[] {`,
    `  return contexts.map((context) => {`,
    `    const envVar = context.envVar ?? context.select?.env`,
    `    const flag = context.flag ?? context.select?.flag`,
    `    if (!envVar) {`,
    `      return { id: ${'`context.${context.id}`'}, status: 'pass', message: 'Context is selected by CLI flag when required.', details: { flag } }`,
    `    }`,
    `    const set = typeof ctx.env[envVar] === 'string' && ctx.env[envVar]!.length > 0`,
    `    return {`,
    `      id: ${'`context.${context.id}`'},`,
    `      status: set ? 'pass' : 'warn',`,
    `      message: set ? 'Context env var is set.' : 'Context env var is missing; pass the context flag when required.',`,
    `      details: { envVar, flag },`,
    `    }`,
    `  })`,
    `}`,
    ``,
    `function generatedAgentReadinessCheck(capabilities: readonly any[]): GeneratedDoctorCheck {`,
    `  const agentVisible = capabilities.filter((cap) => cap.surfaces?.agent === true)`,
    `  const risky = agentVisible.filter((cap) => cap.policy?.dangerous === true || cap.effects?.kind === 'delete' || cap.effects?.kind === 'auth-session-delete')`,
    `  const underAnnotated = agentVisible.filter((cap) => !cap.effects || !cap.policy)`,
    `  const needsAttention = risky.length > 0 || underAnnotated.length > 0`,
    `  return {`,
    `    id: 'agent.commands',`,
    `    status: needsAttention ? 'warn' : 'pass',`,
    `    message: risky.length > 0 ? 'Some agent-visible commands require extra confirmation policy.' : underAnnotated.length > 0 ? 'Some agent-visible commands need explicit effects and policy metadata.' : 'Agent-visible commands have explicit non-destructive posture.',`,
    `    details: { visible: agentVisible.map((cap) => cap.id).sort(), risky: risky.map((cap) => cap.id).sort(), underAnnotated: underAnnotated.map((cap) => cap.id).sort() },`,
    `  }`,
    `}`,
    ``,
    `function generatedNoticeChecks(notices: { updates?: readonly unknown[]; channels?: readonly unknown[]; yanks?: readonly unknown[] }): GeneratedDoctorCheck[] {`,
    `  const updates = notices.updates?.length ?? 0`,
    `  const channels = notices.channels?.length ?? 0`,
    `  const yanks = notices.yanks?.length ?? 0`,
    `  return [`,
    `    { id: 'notices.updates', status: updates > 0 ? 'warn' : 'pass', message: updates > 0 ? 'Static update notices are present.' : 'No static update notices are present.', details: { count: updates } },`,
    `    { id: 'notices.channels', status: channels > 0 ? 'pass' : 'warn', message: channels > 0 ? 'Static channel metadata is present.' : 'No static channel metadata is present.', details: { count: channels } },`,
    `    { id: 'notices.yanks', status: yanks > 0 ? 'warn' : 'pass', message: yanks > 0 ? 'Static yanked-version notices are present.' : 'No static yanked-version notices are present.', details: { count: yanks } },`,
    `  ]`,
    `}`,
    ``,
    `function generatedReleaseChecks(release: any): GeneratedDoctorCheck[] {`,
    `  if (!release) {`,
    `    return [{`,
    `      id: 'release.metadata',`,
    `      status: 'warn',`,
    `      message: 'No static release metadata is embedded.',`,
    `    }]`,
    `  }`,
    `  const install = Array.isArray(release.install) ? release.install : []`,
    `  const packages = Array.isArray(release.packages) ? release.packages : []`,
    `  const yankedVersions = Array.isArray(release.yankedVersions) ? release.yankedVersions : []`,
    `  const latestVersion = typeof release.latestVersion === 'string' && release.latestVersion.length > 0 ? release.latestVersion : release.version`,
    `  const currentYank = yankedVersions.find((entry: any) => entry.version === release.version)`,
    `  return [`,
    `    {`,
    `      id: 'release.metadata',`,
    `      status: 'pass',`,
    `      message: 'Static release metadata is embedded.',`,
    `      details: { version: release.version, channel: release.channel ?? 'stable', createdAt: release.createdAt, manifest: release.manifest },`,
    `    },`,
    `    {`,
    `      id: 'release.install',`,
    `      status: install.length > 0 ? 'pass' : 'warn',`,
    `      message: install.length > 0 ? 'Static install commands are available.' : 'No static install commands are available.',`,
    `      details: { count: install.length, managers: install.map((entry: any) => entry.manager).sort() },`,
    `    },`,
    `    {`,
    `      id: 'release.update',`,
    `      status: latestVersion !== release.version ? 'warn' : 'pass',`,
    `      message: latestVersion !== release.version ? 'A newer static release version is advertised.' : 'Current release version matches the latest static release metadata.',`,
    `      details: { currentVersion: release.version, latestVersion },`,
    `    },`,
    `    {`,
    `      id: 'release.channel',`,
    `      status: release.channel ? 'pass' : 'warn',`,
    `      message: release.channel ? 'Static release channel is declared.' : 'No static release channel is declared.',`,
    `      details: { channel: release.channel ?? 'stable', packages: packages.length },`,
    `    },`,
    `    {`,
    `      id: 'release.yanks',`,
    `      status: currentYank ? 'fail' : yankedVersions.length > 0 ? 'warn' : 'pass',`,
    `      message: currentYank ? 'The current release version is statically marked as yanked.' : yankedVersions.length > 0 ? 'Static yanked-version metadata is present.' : 'No static yanked-version metadata is present.',`,
    `      details: { count: yankedVersions.length, currentVersionYanked: currentYank ? true : false },`,
    `    },`,
    `  ]`,
    `}`,
    ``,
    `function countGeneratedDoctorChecks(checks: readonly GeneratedDoctorCheck[]): { pass: number; warn: number; fail: number } {`,
    `  return {`,
    `    pass: checks.filter((check) => check.status === 'pass').length,`,
    `    warn: checks.filter((check) => check.status === 'warn').length,`,
    `    fail: checks.filter((check) => check.status === 'fail').length,`,
    `  }`,
    `}`,
  ]
}

function renderAuth(auth: Exclude<NormalizedAuth, { kind: 'none' }>): string {
  const sources = auth.tokenSources
    .map((s) => {
      if (s.kind === 'session') {
        return `{ kind: 'session', profiles: ${s.profiles ? 'true' : 'false'}, refresh: ${s.refresh ? 'true' : 'false'} }`
      }
      const fields = [`kind: 'env'`, `envVar: ${q(s.envVar)}`, `mode: ${q(s.mode)}`]
      if (s.label) fields.push(`label: ${q(s.label)}`)
      if (s.scopes) fields.push(`scopes: ${renderStringArray(s.scopes)}`)
      return `{ ${fields.join(', ')} }`
    })
    .join(', ')
  const parts = [`id: ${q(auth.id)}`, `kind: ${q(auth.kind)}`]
  if (auth.header) parts.push(`header: ${q(auth.header)}`)
  if (auth.tokenKind) parts.push(`tokenKind: ${q(auth.tokenKind)}`)
  parts.push(`tokenSources: [${sources}]`)
  if (auth.session) parts.push(`session: { enabled: true, profiles: ${auth.session.profiles ? 'true' : 'false'} }`)
  if (auth.commands) parts.push(`commands: ${renderAuthCommands(auth.commands)}`)
  if (auth.oauthDevice) parts.push(`oauthDevice: ${renderOauthDevice(auth.oauthDevice)}`)
  if (auth.identity) parts.push(`identity: ${renderIdentity(auth.identity)}`)
  return `{ ${parts.join(', ')} }`
}

function renderAuthCommands(commands: Exclude<NormalizedAuth, { kind: 'none' }>['commands']): string {
  const entries = Object.entries(commands ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${q(value as string)}`)
  return `{ ${entries.join(', ')} }`
}

function renderOauthDevice(oauth: NonNullable<Exclude<NormalizedAuth, { kind: 'none' }>['oauthDevice']>): string {
  const endpoints = [
    `deviceAuthorization: ${q(oauth.endpoints.deviceAuthorization)}`,
    `token: ${q(oauth.endpoints.token)}`,
  ]
  if (oauth.endpoints.revoke) endpoints.push(`revoke: ${q(oauth.endpoints.revoke)}`)
  const parts = [`clientId: ${q(oauth.clientId)}`, `endpoints: { ${endpoints.join(', ')} }`]
  if (oauth.scopes) parts.push(`scopes: ${renderStringArray(oauth.scopes)}`)
  return `{ ${parts.join(', ')} }`
}

function renderIdentity(identity: NonNullable<Exclude<NormalizedAuth, { kind: 'none' }>['identity']>): string {
  const parts = [
    `http: { method: ${q(identity.http.method)}, path: ${q(identity.http.path)} }`,
    `subject: ${q(identity.subject)}`,
  ]
  if (identity.label) parts.push(`label: ${q(identity.label)}`)
  return `{ ${parts.join(', ')} }`
}

function renderContexts(contexts: NormalizedContext[]): string {
  const entries = contexts.map((c) => {
    const parts = [`id: ${q(c.id)}`]
    if (c.label) parts.push(`label: ${q(c.label)}`)
    if (c.select.flag) parts.push(`flag: ${q(c.select.flag)}`)
    if (c.select.env) parts.push(`envVar: ${q(c.select.env)}`)
    return `{ ${parts.join(', ')} }`
  })
  return `[${entries.join(', ')}]`
}

function renderHeader(catalog: Catalog, options: GenerateOptions): string[] {
  return [
    '/**',
    ` * @generated by @liche/product ${options.generatorVersion}`,
    ` * product: ${catalog.product.id}@${catalog.product.version}`,
    ` * canonical-catalog-digest: ${options.canonicalIrDigest}`,
    ` * generation-options-digest: ${options.generationOptionsDigest}`,
    ` * surface-id: ${options.surfaceId ?? 'cli'}`,
    ' * source: catalog',
    ' *',
    ' * Do not edit by hand. Regenerate via `liche-product generate`.',
    ' */',
  ]
}

type ParsedHandler = { module: string; export: string }

function parseHandler(handler: string): ParsedHandler {
  const lastDot = handler.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === handler.length - 1) {
    throw new Error(`Handler '${handler}' must be of the form 'module.export'`)
  }
  return { module: handler.slice(0, lastDot), export: handler.slice(lastDot + 1) }
}

function handlerModulePath(module: string): string {
  return `./impl/${module}.js`
}

function collectLocalHandlers(catalog: Catalog): ParsedHandler[] {
  const out: ParsedHandler[] = []
  for (const cap of catalog.capabilities) {
    if (cap.kind !== 'command') continue
    if (cap.family === 'auth') continue
    if (cap.execution.mode === 'local' || cap.execution.mode === 'hybrid-workflow') {
      out.push(parseHandler(cap.execution.handler))
    }
  }
  return out
}

function renderImports(catalog: Catalog): string[] {
  const coreNames = new Set(['defineCli', 'defineCommand', 'z'])
  if (catalog.remote && catalog.capabilities.some(hasHttpTransport)) coreNames.add('callHttpOperation')
  const out: string[] = [`import { ${[...coreNames].sort().join(', ')} } from '@liche/core'`]
  if (needsAuthExtension(catalog)) {
    const authNames = [
      'auth as authExtension',
      ...(catalog.capabilities.some(isAuthCommand) ? ['authSwitch', 'authWhoami', 'logoutAuthSession', 'oauthDeviceLogin'] : []),
      ...(authRuntimeUsed(catalog) ? ['createFileSessionStore', 'resolveAuth'] : []),
      ...(contextRuntimeUsed(catalog) ? ['resolveContext'] : []),
    ].sort()
    out.push(`import { ${authNames.join(', ')} } from '@liche/extensions/auth'`)
  }
  if (catalog.config) {
    out.push(`import { config as configExtension, configDoctor } from '@liche/extensions/config'`)
  }
  if (catalog.ops.enabled && catalog.ops.telemetry !== false) {
    out.push(`import { createLocalTelemetrySink } from '@liche/extensions/telemetry'`)
  }
  const byModule = new Map<string, Set<string>>()
  for (const h of collectLocalHandlers(catalog)) {
    const exports = byModule.get(h.module) ?? new Set<string>()
    exports.add(h.export)
    byModule.set(h.module, exports)
  }
  for (const [module, names] of [...byModule].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const sorted = [...names].sort().join(', ')
    out.push(`import { ${sorted} } from '${handlerModulePath(module)}'`)
  }
  return out
}

function hasHttpTransport(cap: Capability): boolean {
  return cap.kind === 'resource-operation'
    ? cap.http !== undefined
    : cap.execution.mode === 'remote-http'
}

function isAuthCommand(cap: Capability): cap is CommandCapability & { family: 'auth' } {
  return cap.kind === 'command' && cap.family === 'auth'
}

function renderCli(catalog: Catalog): string[] {
  const lines: string[] = []
  lines.push(`const cli = defineCli({`)
  lines.push(`  name: ${q(catalog.product.id)},`)
  lines.push(`  version: ${q(catalog.product.version)},`)
  lines.push(`  generated: { machineOutput: 'envelope', disabledGlobals: ['format'] },`)
  const extensions = renderExtensionDeclarations(catalog)
  if (extensions.length > 0) lines.push(`  extensions: [${extensions.join(', ')}],`)
  if (catalog.ops.enabled && catalog.ops.telemetry !== false) {
    lines.push(`  events: [createLocalTelemetrySink({ enabledEnvVar: TELEMETRY_ENABLED_ENV_VAR, fileEnvVar: TELEMETRY_FILE_ENV_VAR })],`)
  }
  lines.push(`  commands: [`)
  for (const cap of catalog.capabilities) {
    lines.push(...renderCapability('    ', catalog, cap))
  }
  if (catalog.ops.enabled) lines.push(...renderOpsCommands('    ', catalog))
  lines.push(`  ],`)
  lines.push(`})`)
  lines.push('')
  lines.push(`export default cli`)
  return lines
}

function renderExtensionDeclarations(catalog: Catalog): string[] {
  const extensions: string[] = []
  if (needsAuthExtension(catalog)) extensions.push('authExtension()')
  if (catalog.config) {
    extensions.push(renderConfigExtension(catalog))
    extensions.push('configDoctor()')
  }
  return extensions
}

function needsAuthExtension(catalog: Catalog): boolean {
  return authRuntimeUsed(catalog) || contextRuntimeUsed(catalog)
}

function renderOpsCommands(indent: string, catalog: Catalog): string[] {
  const lines: string[] = []
  if (catalog.ops.enabled && catalog.ops.doctor !== false) {
    const envFields = doctorEnvVars(catalog).map((envVar) => `${q(envVar)}: z.string().optional()`).join(', ')
    lines.push(`${indent}defineCommand({`)
    lines.push(`${indent}  path: ['doctor'],`)
    lines.push(`${indent}  agent: true,`)
    lines.push(`${indent}  summary: 'Run local installation and PATH diagnostics.',`)
    lines.push(`${indent}  input: { env: z.object({ ${envFields} }) },`)
    lines.push(`${indent}  output: z.unknown(),`)
    lines.push(`${indent}  safety: { auth: 'none', destructive: false, idempotent: true, interactive: 'never', openWorld: false, readOnly: true },`)
    lines.push(`${indent}  async run({ ctx }) {`)
    lines.push(`${indent}    const local = await runGeneratedLocalDoctor({`)
    lines.push(`${indent}      cliName: PRODUCT_ID,`)
    lines.push(`${indent}      version: ${q(catalog.product.version)},`)
    lines.push(`${indent}      env: ctx.env as Record<string, string | undefined>,`)
    lines.push(`${indent}      packageManagers: DOCTOR_PACKAGE_MANAGERS,`)
    lines.push(`${indent}    })`)
    lines.push(`${indent}    return withGeneratedProductDoctor(ctx, local)`)
    lines.push(`${indent}  },`)
    lines.push(`${indent}}),`)
  }
  lines.push(`${indent}defineCommand({`)
  lines.push(`${indent}  path: ['catalog'],`)
  lines.push(`${indent}  agent: true,`)
  lines.push(`${indent}  summary: 'Print the generated local catalog artifact.',`)
  lines.push(`${indent}  output: z.unknown(),`)
  lines.push(`${indent}  safety: { auth: 'none', destructive: false, idempotent: true, interactive: 'never', openWorld: false, readOnly: true },`)
  lines.push(`${indent}  run() { return GENERATED_CATALOG },`)
  lines.push(`${indent}}),`)
  lines.push(`${indent}defineCommand({`)
  lines.push(`${indent}  path: ['notices'],`)
  lines.push(`${indent}  agent: true,`)
  lines.push(`${indent}  summary: 'Print static update, channel, and yank notices.',`)
  lines.push(`${indent}  output: z.unknown(),`)
  lines.push(`${indent}  safety: { auth: 'none', destructive: false, idempotent: true, interactive: 'never', openWorld: false, readOnly: true },`)
  lines.push(`${indent}  run() { return STATIC_NOTICES },`)
  lines.push(`${indent}}),`)
  if (catalog.ops.release !== false) {
    lines.push(`${indent}defineCommand({`)
    lines.push(`${indent}  path: ['release'],`)
    lines.push(`${indent}  agent: true,`)
    lines.push(`${indent}  summary: 'Print static release, install, update, and channel metadata.',`)
    lines.push(`${indent}  output: z.unknown(),`)
    lines.push(`${indent}  safety: { auth: 'none', destructive: false, idempotent: true, interactive: 'never', openWorld: false, readOnly: true },`)
    lines.push(`${indent}  run() { return STATIC_RELEASE },`)
    lines.push(`${indent}}),`)
  }
  if (catalog.ops.enabled && catalog.ops.telemetry !== false) {
    lines.push(`${indent}defineCommand({`)
    lines.push(`${indent}  path: ['telemetry'],`)
    lines.push(`${indent}  agent: true,`)
    lines.push(`${indent}  summary: 'Show local telemetry sink status.',`)
    lines.push(`${indent}  input: { env: z.object({`)
    lines.push(`${indent}    [TELEMETRY_ENABLED_ENV_VAR]: z.string().optional(),`)
    lines.push(`${indent}    [TELEMETRY_FILE_ENV_VAR]: z.string().optional(),`)
    lines.push(`${indent}  }) },`)
    lines.push(`${indent}  output: z.unknown(),`)
    lines.push(`${indent}  safety: { auth: 'none', destructive: false, idempotent: true, interactive: 'never', openWorld: false, readOnly: true },`)
    lines.push(`${indent}  run({ ctx }) {`)
    lines.push(`${indent}    const raw = ctx.env[TELEMETRY_ENABLED_ENV_VAR]`)
    lines.push(`${indent}    const enabled = raw !== undefined && raw !== '' && raw !== '0' && raw.toLowerCase() !== 'false'`)
    lines.push(`${indent}    return {`)
    lines.push(`${indent}      enabled,`)
    lines.push(`${indent}      sink: ctx.env[TELEMETRY_FILE_ENV_VAR] ? { kind: 'file', path: ctx.env[TELEMETRY_FILE_ENV_VAR] } : undefined,`)
    lines.push(`${indent}      redaction: 'enabled',`)
    lines.push(`${indent}    }`)
    lines.push(`${indent}  },`)
    lines.push(`${indent}}),`)
  }
  return lines
}

function doctorEnvVars(catalog: Catalog): string[] {
  const names = new Set<string>(['PATH'])
  if (catalog.remote?.baseUrl.kind === 'env') names.add(catalog.remote.baseUrl.envVar)
  if (catalog.auth.kind !== 'none') {
    for (const source of catalog.auth.tokenSources) {
      if (source.kind === 'env') names.add(source.envVar)
    }
  }
  for (const context of catalog.contexts) {
    if (context.select.env) names.add(context.select.env)
  }
  return [...names].sort()
}

function renderCapability(indent: string, catalog: Catalog, cap: Capability): string[] {
  if (isAuthCommand(cap)) return renderAuthCapability(indent, catalog, cap)
  const lines: string[] = []
  lines.push(`${indent}defineCommand({`)
  lines.push(`${indent}  path: ${renderStringArray(cap.command)},`)
  lines.push(`${indent}  agent: ${cap.surfaces.agent ? 'true' : 'false'},`)
  lines.push(`${indent}  summary: ${q(cap.summary)},`)
  if (cap.description) lines.push(`${indent}  description: ${q(cap.description)},`)
  if (cap.examples.length > 0) lines.push(`${indent}  examples: ${renderExamples(cap.examples)},`)
  if (cap.effects) lines.push(`${indent}  effects: ${renderEffects(cap.effects)},`)
  if (cap.policy) lines.push(`${indent}  policy: ${renderPolicy(cap.policy)},`)
  const inputSchema = capabilityInputSchema(catalog, cap)
  const outputSchema = capabilityOutputSchema(catalog, cap)
  const envSchema = capabilityEnvSchema(catalog, cap)
  const authMetadata = renderCommandAuthMetadata(catalog, cap)
  if (authMetadata) lines.push(`${indent}  auth: ${authMetadata},`)
  const optionConfig = capabilityOptionConfig(cap)
  lines.push(`${indent}  input: {`)
  if (envSchema) lines.push(`${indent}    env: ${renderSchema(envSchema, `${indent}    `)},`)
  if (optionConfig) lines.push(`${indent}    config: ${optionConfig},`)
  lines.push(`${indent}    options: ${renderSchema(inputSchema, `${indent}    `)},`)
  lines.push(`${indent}  },`)
  lines.push(`${indent}  output: ${renderSchema(outputSchema, `${indent}  `)},`)
  lines.push(`${indent}  safety: ${renderSafety(cap)},`)
  lines.push(`${indent}  async run({ ctx }) {`)
  lines.push(...renderCapabilityRun(`${indent}    `, catalog, cap))
  lines.push(`${indent}  },`)
  lines.push(`${indent}}),`)
  return lines
}

function renderAuthCapability(indent: string, catalog: Catalog, cap: CommandCapability): string[] {
  const lines: string[] = []
  lines.push(`${indent}defineCommand({`)
  lines.push(`${indent}  path: ${renderStringArray(cap.command)},`)
  lines.push(`${indent}  agent: ${cap.surfaces.agent ? 'true' : 'false'},`)
  lines.push(`${indent}  summary: ${q(cap.summary)},`)
  if (cap.effects) lines.push(`${indent}  effects: ${renderEffects(cap.effects)},`)
  if (cap.policy) lines.push(`${indent}  policy: ${renderPolicy(cap.policy)},`)
  lines.push(`${indent}  safety: ${renderSafety(cap)},`)
  lines.push(`${indent}  input: {`)
  if (cap.id === 'auth.switch') {
    lines.push(`${indent}    options: ${renderSwitchOptions(catalog.contexts, `${indent}    `)},`)
  } else if (cap.id === 'auth.logout') {
    lines.push(`${indent}    options: z.object({ profile: z.string().optional(), all: z.boolean().optional() }),`)
  } else {
    lines.push(`${indent}    options: z.object({ profile: z.string().optional() }),`)
  }
  lines.push(`${indent}  },`)
  lines.push(`${indent}  output: ${renderAuthOutputSchema(cap.id)},`)
  if (cap.id === 'auth.whoami') {
    lines.push(`${indent}  auth: { required: false, status: 'requires-runtime-resolution', providerId: AUTH_PROVIDER.id },`)
  }
  lines.push(`${indent}  async run({ ctx }) {`)
  lines.push(`${indent}    const sessionStore = createFileSessionStore()`)
  lines.push(`${indent}    const profile = typeof ctx.options.profile === 'string' ? ctx.options.profile : undefined`)
  if (cap.id === 'auth.whoami') {
    lines.push(`${indent}    const data = await authWhoami({`)
    lines.push(...renderAuthRuntimeArgs(`${indent}      `, catalog))
    lines.push(`${indent}      profile,`)
    lines.push(`${indent}      sessionStore,`)
    lines.push(`${indent}    })`)
  } else if (cap.id === 'auth.switch') {
    lines.push(`${indent}    const data = await authSwitch({`)
    lines.push(...renderAuthRuntimeArgs(`${indent}      `, catalog))
    lines.push(`${indent}      contexts: CONTEXTS,`)
    lines.push(`${indent}      profile,`)
    lines.push(`${indent}      sessionStore,`)
    lines.push(`${indent}      values: ctx.options as Record<string, string | undefined>,`)
    lines.push(`${indent}    })`)
  } else if (cap.id === 'auth.login') {
    lines.push(`${indent}    const data = await oauthDeviceLogin({`)
    lines.push(...renderAuthRuntimeArgs(`${indent}      `, catalog))
    lines.push(`${indent}      interactive: ctx.isTty,`)
    lines.push(`${indent}      profile,`)
    lines.push(`${indent}      sessionStore,`)
    lines.push(`${indent}    })`)
  } else if (cap.id === 'auth.logout') {
    lines.push(`${indent}    const data = await logoutAuthSession({`)
    lines.push(...renderAuthRuntimeArgs(`${indent}      `, catalog))
    lines.push(`${indent}      all: ctx.options.all === true,`)
    lines.push(`${indent}      profile,`)
    lines.push(`${indent}      sessionStore,`)
    lines.push(`${indent}    })`)
  }
  lines.push(`${indent}    return ctx.ok(data, { execution: { mode: 'local', source: 'schema-default' } })`)
  lines.push(`${indent}  },`)
  lines.push(`${indent}}),`)
  return lines
}

function renderAuthRuntimeArgs(indent: string, catalog: Catalog): string[] {
  const lines = [
    `${indent}productId: PRODUCT_ID,`,
    `${indent}provider: AUTH_PROVIDER,`,
    `${indent}profileEnvVar: PROFILE_ENV_VAR,`,
    `${indent}global: ctx.global,`,
    `${indent}invocation: ctx.invocation,`,
    `${indent}env: ctx.env as Record<string, string | undefined>,`,
    `${indent}loginCommand: ${q(`${catalog.product.id} login`)},`,
  ]
  if (catalog.remote) lines.push(`${indent}baseUrl: ${renderRuntimeValue(catalog.remote.baseUrl)},`)
  return lines
}

function renderSwitchOptions(contexts: NormalizedContext[], indent: string): string {
  const entries = [`${indent}  profile: z.string().optional(),`]
  for (const ctx of contexts) {
    if (!ctx.select.flag) continue
    entries.push(`${indent}  ${q(ctx.select.flag)}: z.string().optional(),`)
  }
  return `z.object({\n${entries.join('\n')}\n${indent}})`
}

function renderAuthOutputSchema(id: string): string {
  const account = `z.object({ id: z.string(), label: z.string().optional() })`
  const contexts = `z.record(z.string(), z.string())`
  if (id === 'auth.switch') {
    return `z.object({ profile: z.string(), contexts: ${contexts} })`
  }
  if (id === 'auth.logout') {
    return `z.object({ authenticated: z.boolean(), deleted: z.number(), profile: z.string().optional() })`
  }
  const fields = [
    `authenticated: z.boolean()`,
    `source: z.enum(['env', 'session']).optional()`,
    `profile: z.string().optional()`,
    `account: ${account}.optional()`,
    `contexts: ${contexts}.optional()`,
    `expiresAt: z.string().optional()`,
    `refreshAvailable: z.boolean().optional()`,
  ]
  if (id === 'auth.login') {
    fields.push(`verificationUri: z.string().optional()`)
    fields.push(`userCode: z.string().optional()`)
  }
  return `z.object({ ${fields.join(', ')} })`
}

function capabilityInputSchema(catalog: Catalog, cap: Capability): JsonSchemaNode {
  const base = cap.input
    ? shapeToJsonSchema(catalog, cap.input)
    : ({ type: 'object', properties: {} } as JsonSchemaNode)
  if (cap.requires.contexts.length === 0) return base
  // Inject declared context flags as optional string options so env fallback
  // can still resolve the context inside resolveContext.
  const properties: Record<string, JsonSchemaNode> = { ...(base.properties ?? {}) }
  const required = new Set(base.required ?? [])
  for (const ctxId of cap.requires.contexts) {
    const ctx = catalog.contexts.find((c) => c.id === ctxId)
    if (!ctx) continue
    const flag = ctx.select.flag
    if (!flag) continue
    if (properties[flag]) continue
    const node: JsonSchemaNode = { type: 'string' }
    if (ctx.label) node.description = ctx.label
    properties[flag] = node
  }
  const out: JsonSchemaNode = { type: 'object', properties }
  if (required.size > 0) out.required = [...required].sort()
  return out
}

function capabilityEnvSchema(catalog: Catalog, cap: Capability): JsonSchemaNode | undefined {
  const envVars = new Set<string>()
  if (needsAuthResolution(cap) && catalog.auth.kind !== 'none') {
    for (const source of catalog.auth.tokenSources) {
      if (source.kind === 'env') envVars.add(source.envVar)
    }
  }
  for (const ctxId of cap.requires.contexts) {
    const ctx = catalog.contexts.find((c) => c.id === ctxId)
    if (ctx?.select.env) envVars.add(ctx.select.env)
  }
  if (catalog.remote?.baseUrl.kind === 'env' && hasHttpTransport(cap)) envVars.add(catalog.remote.baseUrl.envVar)
  if (envVars.size === 0) return undefined
  const properties: Record<string, JsonSchemaNode> = {}
  for (const envVar of [...envVars].sort()) properties[envVar] = { type: 'string' }
  return { type: 'object', properties }
}

function capabilityOptionConfig(cap: Capability): string | undefined {
  if (!cap.input || cap.input.kind !== 'object') return undefined
  const entries = Object.entries(cap.input.properties)
    .filter(([, field]) => field.configPath !== undefined)
    .map(([key, field]) => `${q(key)}: ${q(field.configPath!)}`)
    .sort()
  return entries.length ? `{ ${entries.join(', ')} }` : undefined
}

function capabilityOutputSchema(catalog: Catalog, cap: Capability): JsonSchemaNode {
  if (cap.kind === 'resource-operation') return shapeToJsonSchema(catalog, cap.output)
  if (cap.output) return shapeToJsonSchema(catalog, cap.output)
  return { type: 'object', properties: {} }
}

function shapeToJsonSchema(catalog: Catalog, shape: NormalizedShape): JsonSchemaNode {
  if (shape.kind === 'object') return shape.jsonSchema
  const resolved = resolveListShape(catalog, shape)
  if (!resolved.ok) {
    throw new Error(
      `Generator cannot render list shape: resource '${resolved.resourceId}' is not declared in this catalog`,
    )
  }
  return resolved.jsonSchema
}

function renderCapabilityRun(indent: string, catalog: Catalog, cap: Capability): string[] {
  const preamble = renderAuthPreamble(indent, catalog, cap)
  if (cap.kind === 'resource-operation') {
    if (!cap.http) throw new Error(`Generated CLI cannot render resource operation '${cap.id}' because it has no HTTP transport.`)
    if (!catalog.remote) throw missingRemoteError(cap.id)
    return renderRemoteCall(indent, catalog, cap, cap.http, preamble)
  }
  const mode = cap.execution.mode
  if (mode === 'remote-http') {
    if (!catalog.remote) throw missingRemoteError(cap.id)
    return renderRemoteCall(indent, catalog, cap, cap.execution.http, preamble)
  }
  const parsed = parseHandler(cap.execution.handler)
  return [
    ...preamble,
    `${indent}const data = await ${parsed.export}(ctx.options)`,
    `${indent}return ctx.ok(data, { execution: { mode: ${q(mode)}, source: 'schema-default' } })`,
  ]
}

function renderRemoteCall(
  indent: string,
  catalog: Catalog,
  cap: Capability,
  http: NonNullable<ResourceOperationCapability['http']>,
  preamble: string[],
): string[] {
  const remote = renderRemoteBaseUrlSetup(indent, catalog.remote!.baseUrl)
  const inputExpr = neededContexts(cap).length > 0
    ? `{ ...(ctx.options as Record<string, unknown>), ...context }`
    : `ctx.options as Record<string, unknown>`
  const authExpr = needsAuthResolution(cap)
    ? `credential ? { kind: 'resolved', credential } : { kind: 'none' }`
    : `{ kind: 'none' }`
  return [
    ...preamble,
    ...remote.lines,
    `${indent}const data = await callHttpOperation({`,
    `${indent}  id: ${q(cap.id)},`,
    `${indent}  baseUrl: ${remote.value},`,
    `${indent}  auth: ${authExpr},`,
    `${indent}  method: ${q(http.method)},`,
    `${indent}  path: ${q(http.path)},`,
    `${indent}  bind: ${renderHttpBind(http.bind)},`,
    `${indent}  input: ${inputExpr},`,
    `${indent}  inputFields: ${renderStringArray(remoteInputFieldNames(catalog, cap))},`,
    `${indent}  output: ${renderSchema(capabilityOutputSchema(catalog, cap), `${indent}  `)},`,
    `${indent}  env: ctx.env as Record<string, string | undefined>,`,
    ...(cap.requires.permissions.length > 0 ? [`${indent}  requiredPermissions: ${renderStringArray(cap.requires.permissions)},`] : []),
    `${indent}})`,
    `${indent}return ctx.ok(data, { execution: { mode: 'remote-http', source: ${remote.source} } })`,
  ]
}

function renderRemoteBaseUrlSetup(
  indent: string,
  value: NormalizedRuntimeValue,
): { lines: string[]; source: string; value: string } {
  if (value.kind === 'literal') {
    return { lines: [], source: q('schema-default'), value: q(value.value) }
  }

  if (value.kind === 'env') {
    const envExpr = `ctx.env[${q(value.envVar)}]`
    const source = `${envExpr} && ${envExpr}.length > 0 ? 'env' : 'schema-default'`
    return { lines: [], source, value: renderRuntimeValue(value) }
  }

  const path = q(value.path)
  return {
    lines: [
      `${indent}const remoteBaseUrl = ctx.config[${path}]`,
      `${indent}if (typeof remoteBaseUrl !== 'string' || remoteBaseUrl.length === 0) {`,
      `${indent}  return ctx.error({`,
      `${indent}    code: 'REMOTE_CONFIG_MISSING_BASE_URL',`,
      `${indent}    code_actions: [{ title: 'Inspect config', argv: ['config', 'doctor'] }],`,
      `${indent}    message: 'Remote base URL is required.',`,
      `${indent}    suggested_fix: ${q(`Set ${value.path} in config before retrying.`)},`,
      `${indent}  })`,
      `${indent}}`,
      `${indent}const remoteBaseUrlSource = ctx.sources.config(${path}).kind === 'default' ? 'schema-default' : 'config'`,
    ],
    source: 'remoteBaseUrlSource',
    value: 'remoteBaseUrl',
  }
}

function renderAuthPreamble(indent: string, catalog: Catalog, cap: Capability): string[] {
  const lines: string[] = []
  if (needsAuthResolution(cap)) {
    lines.push(`${indent}const sessionStore = createFileSessionStore()`)
    lines.push(`${indent}const credential = await resolveAuth({`)
    lines.push(`${indent}  provider: AUTH_PROVIDER,`)
    lines.push(`${indent}  productId: PRODUCT_ID,`)
    lines.push(`${indent}  required: true,`)
    if (cap.requires.permissions.length > 0) {
      lines.push(`${indent}  requiredPermissions: ${renderStringArray(cap.requires.permissions)},`)
    }
    const requiredScopes = requiredScopesFor(catalog.permissions, cap)
    if (requiredScopes.length > 0) {
      lines.push(`${indent}  requiredScopes: ${renderStringArray(requiredScopes)},`)
    }
    lines.push(`${indent}  invocation: ctx.invocation,`)
    lines.push(`${indent}  profile: ctx.global.profile,`)
    lines.push(`${indent}  profileEnvVar: PROFILE_ENV_VAR,`)
    lines.push(`${indent}  nonInteractive: ctx.global.nonInteractive,`)
    lines.push(`${indent}  noSession: ctx.global.noSession,`)
    lines.push(`${indent}  env: ctx.env as Record<string, string | undefined>,`)
    lines.push(`${indent}  loginCommand: ${q(`${catalog.product.id} login`)},`)
    lines.push(`${indent}  sessionStore,`)
    lines.push(`${indent}})`)
  }
  if (neededContexts(cap).length > 0) {
    if (needsAuthResolution(cap)) {
      lines.push(`${indent}const storedProfile = !ctx.global.noSession && (credential?.source === 'session' || ctx.global.profile)`)
      lines.push(`${indent}  ? await sessionStore.loadProfile(PRODUCT_ID, AUTH_PROVIDER.id, credential?.profile ?? ctx.global.profile ?? 'default')`)
      lines.push(`${indent}  : undefined`)
    }
    const required = neededContexts(cap).map((c) => q(c)).join(', ')
    lines.push(`${indent}const context = await resolveContext({`)
    lines.push(`${indent}  contexts: CONTEXTS,`)
    lines.push(`${indent}  required: [${required}],`)
    lines.push(`${indent}  explicit: ctx.options as Record<string, string | undefined>,`)
    lines.push(`${indent}  env: ctx.env as Record<string, string | undefined>,`)
    if (needsAuthResolution(cap)) {
      lines.push(`${indent}  providerId: AUTH_PROVIDER.id,`)
      lines.push(`${indent}  credentialSource: credential?.source ?? 'none',`)
      lines.push(`${indent}  profile: storedProfile,`)
      lines.push(`${indent}  profileExplicit: ctx.global.profile !== undefined,`)
    }
    lines.push(`${indent}})`)
  }
  if (needsAuthResolution(cap)) {
  }
  // Mark intentionally-unused auth/context locals for non-HTTP commands.
  if (!hasHttpTransport(cap) && needsAuthResolution(cap)) lines.push(`${indent}void credential`)
  if (!hasHttpTransport(cap) && neededContexts(cap).length > 0) lines.push(`${indent}void context`)
  return lines
}

function renderConfigExtension(catalog: Catalog): string {
  const config = catalog.config!
  const fields: string[] = []
  if (config.files.length > 0) fields.push(`files: ${renderStringArray(config.files)}`)
  fields.push(`schema: ${renderStrictObjectSchema(config.fields, '  ')}`)
  fields.push(`scopes: ${renderConfigScopes(config.scopes)}`)
  return `configExtension({ ${fields.join(', ')} })`
}

function renderConfigScopes(scopes: NonNullable<Catalog['config']>['scopes']): string {
  const project = scopes.project === false
    ? 'false'
    : `{ discoverUpwards: ${scopes.project.discoverUpwards ? 'true' : 'false'} }`
  const user = scopes.user === false ? 'false' : `{ xdg: ${scopes.user.xdg ? 'true' : 'false'} }`
  return `{ project: ${project}, user: ${user} }`
}

function renderStrictObjectSchema(shape: NormalizedObjectShape, indent: string): string {
  const schema = renderSchema(shape.jsonSchema, indent)
  return schema.startsWith('z.object(') ? `z.strictObject(${schema.slice('z.object('.length)}` : schema
}

function renderRuntimeValue(value: NormalizedRuntimeValue): string {
  if (value.kind === 'literal') return q(value.value)
  if (value.kind === 'env') {
    const parts = [`envVar: ${q(value.envVar)}`]
    if (value.fallback !== undefined) parts.push(`literal: ${q(value.fallback)}`)
    return `{ ${parts.join(', ')} }`
  }
  return `ctx.config[${q(value.path)}] as string`
}

function renderHttpBind(bind: NormalizedHttpBind): string {
  const parts: string[] = []
  if (bind.path.length > 0) parts.push(`path: ${renderStringArray(bind.path)}`)
  if (bind.query.length > 0) parts.push(`query: ${renderStringArray(bind.query)}`)
  const headerEntries = Object.entries(bind.headers)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${q(key)}: ${q(String(value))}`)
  if (headerEntries.length > 0) parts.push(`headers: { ${headerEntries.join(', ')} }`)
  if (bind.body === true) parts.push(`body: true`)
  else if (Array.isArray(bind.body)) parts.push(`body: ${renderStringArray(bind.body)}`)
  else parts.push(`body: false`)
  return `{ ${parts.join(', ')} }`
}

function inputFieldNames(catalog: Catalog, cap: Capability): string[] {
  if (!cap.input) return []
  const schema = shapeToJsonSchema(catalog, cap.input)
  return Object.keys(schema.properties ?? {}).sort()
}

function remoteInputFieldNames(catalog: Catalog, cap: Capability): string[] {
  return [...new Set([...inputFieldNames(catalog, cap), ...neededContexts(cap)])].sort()
}

function requiredScopesFor(permissions: NormalizedPermission[], cap: Capability): string[] {
  const byId = new Map(permissions.map((permission) => [permission.id, permission]))
  return cap.requires.permissions.flatMap((id) => {
    const scope = byId.get(id)?.scope
    return scope ? [scope] : []
  })
}

function renderCommandAuthMetadata(catalog: Catalog, cap: Capability): string | undefined {
  if (!capabilityHasAuthMetadata(cap)) return undefined
  const status =
    cap.requires.auth || cap.requires.contexts.length > 0
      ? 'requires-runtime-resolution'
      : 'not-required'
  const fields = [
    `required: ${cap.requires.auth ? 'true' : 'false'}`,
    `status: ${q(status)}`,
  ]
  if (cap.requires.auth && catalog.auth.kind !== 'none') {
    fields.push(`providerId: ${q(catalog.auth.id)}`)
    fields.push(`envVars: ${renderStringArray(catalog.auth.tokenSources.flatMap((s) => s.kind === 'env' ? [s.envVar] : []))}`)
  }
  const contexts = cap.requires.contexts.map((ctxId) => {
    const ctx = catalog.contexts.find((c) => c.id === ctxId)
    const parts = [`id: ${q(ctxId)}`]
    if (ctx?.select.flag) parts.push(`flag: ${q(ctx.select.flag)}`)
    if (ctx?.select.env) parts.push(`envVar: ${q(ctx.select.env)}`)
    return `{ ${parts.join(', ')} }`
  })
  if (contexts.length > 0) fields.push(`contexts: [${contexts.join(', ')}]`)
  if (cap.requires.permissions.length > 0) {
    fields.push(`requiredPermissions: ${renderStringArray(cap.requires.permissions)}`)
  }
  const requiredScopes = requiredScopesFor(catalog.permissions, cap)
  if (requiredScopes.length > 0) fields.push(`requiredScopes: ${renderStringArray(requiredScopes)}`)
  return `{ ${fields.join(', ')} }`
}

function renderExamples(examples: NormalizedCapabilityExample[]): string {
  return `[${examples.map((example) => {
    const fields = [`command: ${q(example.command)}`]
    if (example.summary) fields.push(`description: ${q(example.summary)}`)
    return `{ ${fields.join(', ')} }`
  }).join(', ')}]`
}

function renderEffects(effects: NormalizedEffects): string {
  const fields = [`kind: ${q(effects.kind)}`]
  if (effects.idempotent !== undefined) fields.push(`idempotent: ${effects.idempotent ? 'true' : 'false'}`)
  return `{ ${fields.join(', ')} }`
}

function renderPolicy(policy: NormalizedPolicy): string {
  return `{ dangerous: ${policy.dangerous ? 'true' : 'false'}, requiresConfirmation: ${policy.requiresConfirmation ? 'true' : 'false'}, conformanceEligible: ${policy.conformanceEligible ? 'true' : 'false'} }`
}

function renderSafety(cap: Capability): string {
  const effectKind = cap.effects?.kind
  const readOnly = effectKind === 'read' || effectKind === 'auth-session-read'
  const destructive = cap.policy?.dangerous === true || effectKind === 'delete' || effectKind === 'auth-session-delete'
  const idempotent = cap.effects?.idempotent ?? readOnly
  const interactive = cap.kind === 'command' && cap.id === 'auth.login' ? 'required' : 'never'
  const openWorld =
    hasHttpTransport(cap) ||
    needsAuthResolution(cap) ||
    cap.requires.contexts.length > 0 ||
    effectKind === 'exec'
  const auth = cap.requires.auth ? 'required' : 'none'
  return `{ auth: ${q(auth)}, destructive: ${destructive ? 'true' : 'false'}, idempotent: ${idempotent ? 'true' : 'false'}, interactive: ${q(interactive)}, openWorld: ${openWorld ? 'true' : 'false'}, readOnly: ${readOnly ? 'true' : 'false'} }`
}

function renderSchema(jsonSchema: unknown, indent: string): string {
  return renderSchemaNode(jsonSchema as JsonSchemaNode, indent)
}

function renderStringArray(values: readonly string[]): string {
  return `[${values.map(q).join(', ')}]`
}

type SchemaRenderer = (node: JsonSchemaNode, indent: string) => string

const TYPE_RENDERERS: Record<string, SchemaRenderer> = {
  string: () => 'z.string()',
  number: () => 'z.number()',
  integer: () => 'z.number()',
  boolean: () => 'z.boolean()',
  array: (node, indent) => {
    if (!node.items) throw new Error('Array schema missing items')
    return `z.array(${renderSchemaNode(node.items, indent)})`
  },
  object: (node, indent) => renderObjectSchema(node, indent),
}

function renderSchemaNode(node: JsonSchemaNode, indent: string): string {
  if (node.enum && Array.isArray(node.enum)) {
    const literals = node.enum.map((v) => JSON.stringify(v)).join(', ')
    return `z.enum([${literals}])`
  }
  const renderer = node.type ? TYPE_RENDERERS[node.type] : undefined
  if (!renderer) {
    throw new Error(
      `Unsupported JSON Schema type for current generator (type=${node.type}): ${JSON.stringify(node).slice(0, 200)}`,
    )
  }
  return renderer(node, indent)
}

function renderObjectSchema(node: JsonSchemaNode, indent: string): string {
  const props = node.properties ?? {}
  const required = new Set(node.required ?? [])
  const keys = Object.keys(props).sort()
  if (keys.length === 0) return 'z.object({})'
  const inner = keys.map((key) => {
    const child = props[key]!
    let expr = renderSchemaNode(child, `${indent}  `)
    if (child.default !== undefined) {
      expr += `.default(${JSON.stringify(child.default)})`
    } else if (!required.has(key)) {
      expr += '.optional()'
    }
    return `${indent}  ${q(key)}: ${expr},`
  })
  return `z.object({\n${inner.join('\n')}\n${indent}})`
}

function q(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function profileEnvVar(productId: string): string {
  return `${productId.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()}_PROFILE`
}
