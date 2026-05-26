import type { Capability, Catalog, CommandCapability } from '../../catalog/types.js'

export function needsAuthResolution(cap: Capability): boolean {
  return cap.requires.auth === true
}

export function neededContexts(cap: Capability): string[] {
  return [...cap.requires.contexts]
}

export function authRuntimeUsed(catalog: Catalog): boolean {
  if (catalog.auth.kind === 'none') return false
  return catalog.capabilities.some((cap) => needsAuthResolution(cap) || (cap.kind === 'command' && cap.family === 'auth'))
}

export function contextRuntimeUsed(catalog: Catalog): boolean {
  return catalog.capabilities.some((c) => c.requires.contexts.length > 0)
}

export function opsRuntimeUsed(catalog: Catalog): boolean {
  return catalog.ops.enabled && (catalog.ops.doctor !== false || catalog.ops.telemetry !== false)
}

export function capabilityHasAuthMetadata(cap: Capability): boolean {
  return cap.requires.auth || cap.requires.contexts.length > 0 || cap.requires.permissions.length > 0
}

export function hasHttpTransport(cap: Capability): boolean {
  return cap.kind === 'resource-operation'
    ? cap.http !== undefined
    : cap.execution.mode === 'remote-http'
}

export function isAuthCommand(cap: Capability): cap is CommandCapability & { family: 'auth' } {
  return cap.kind === 'command' && cap.family === 'auth'
}

export function needsAuthExtension(catalog: Catalog): boolean {
  return authRuntimeUsed(catalog) || contextRuntimeUsed(catalog)
}

export function needsMcpServer(catalog: Catalog): boolean {
  return catalog.capabilities.some((cap) => cap.surfaces.agent === true)
}

export function needsTokens(catalog: Catalog): boolean {
  return needsMcpServer(catalog)
}

export function profileEnvVar(productId: string): string {
  return `${productId.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()}_PROFILE`
}

export function missingRemoteError(capabilityId: string): Error {
  return new Error(
    `Generated CLI cannot render HTTP capability '${capabilityId}' without defineProduct({ remote: { baseUrl } }).`,
  )
}
