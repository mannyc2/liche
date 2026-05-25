import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Catalog } from '../../catalog/types.js'
import {
  authRuntimeUsed,
  contextRuntimeUsed,
  opsRuntimeUsed,
  profileEnvVar,
} from './predicates.js'
import { q, renderStrictObjectSchema, renderStringArray } from './render.js'
import { renderAuth, renderContexts } from './auth.js'

// The generated CLI's static doctor helpers are pure boilerplate — no inputs
// from the catalog. They live in a sidecar template so the source is readable
// as plain TypeScript instead of an array of escaped string lines.
const DOCTOR_TEMPLATE = readFileSync(join(import.meta.dir, 'doctor-template.txt'), 'utf8')

export function renderRuntimeConstants(catalog: Catalog): string[] {
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

export function renderCatalogConstants(catalog: Catalog): string[] {
  return [
    `const GENERATED_CATALOG = ${JSON.stringify(catalog, null, 2)} as const`,
    `const STATIC_NOTICES = ${JSON.stringify(catalog.ops.notices, null, 2)} as const`,
    `const STATIC_RELEASE = ${JSON.stringify(catalog.ops.release, null, 2)} as const`,
  ]
}

export function renderConfigExtension(catalog: Catalog): string {
  const config = catalog.config!
  const sourceArgs: string[] = []
  if (config.files.length > 0) sourceArgs.push(`files: ${renderStringArray(config.files)}`)
  sourceArgs.push(`scopes: ${renderConfigScopes(config.scopes)}`)
  const sources = config.files.length > 0 ? `[files({ ${sourceArgs.join(', ')} })]` : '[]'
  const fields: string[] = [
    `schema: ${renderStrictObjectSchema(config.fields, '  ')}`,
    `sources: ${sources}`,
  ]
  return `configExtension({ ${fields.join(', ')} })`
}

function renderConfigScopes(scopes: NonNullable<Catalog['config']>['scopes']): string {
  const project = scopes.project === false
    ? 'false'
    : `{ discoverUpwards: ${scopes.project.discoverUpwards ? 'true' : 'false'} }`
  const user = scopes.user === false ? 'false' : `{ xdg: ${scopes.user.xdg ? 'true' : 'false'} }`
  return `{ project: ${project}, user: ${user} }`
}

export function doctorEnvVars(catalog: Catalog): string[] {
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

export function renderOpsCommands(indent: string, catalog: Catalog): string[] {
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

export function renderProductDoctorHelpers(): string[] {
  return [DOCTOR_TEMPLATE]
}
