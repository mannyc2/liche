import type { Catalog } from '../../catalog/types.js'
import {
  authRuntimeUsed,
  contextRuntimeUsed,
  hasHttpTransport,
  isAuthCommand,
  needsAuthExtension,
  needsMcpServer,
  needsTokens,
} from './predicates.js'

export type ParsedHandler = { module: string; export: string }

export function parseHandler(handler: string): ParsedHandler {
  const lastDot = handler.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === handler.length - 1) {
    throw new Error(`Handler '${handler}' must be of the form 'module.export'`)
  }
  return { module: handler.slice(0, lastDot), export: handler.slice(lastDot + 1) }
}

export function handlerModulePath(module: string): string {
  return `./impl/${module}.js`
}

export function collectLocalHandlers(catalog: Catalog): ParsedHandler[] {
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

export function renderImports(catalog: Catalog): string[] {
  const coreNames = new Set(['defineCli', 'defineCommand', 'help', 'outputControls', 'reflectionControls', 'version', 'z'])
  if (catalog.remote && catalog.capabilities.some(hasHttpTransport)) coreNames.add('callHttpOperation')
  const out: string[] = [`import { ${[...coreNames].sort().join(', ')} } from '@liche/core'`]
  out.push(`import { llms } from '@liche/agents'`)
  if (needsTokens(catalog)) {
    out.push(`import { tokens } from '@liche/tokens'`)
  }
  if (needsAuthExtension(catalog)) {
    const authNames = [
      'auth as authExtension',
      ...(catalog.capabilities.some(isAuthCommand) ? ['authSwitch', 'authWhoami', 'logoutAuthSession', 'oauthDeviceLogin'] : []),
      ...(authRuntimeUsed(catalog) ? ['createFileSessionStore', 'detectInvocation', 'resolveAuth'] : []),
      ...(contextRuntimeUsed(catalog) ? ['resolveContext'] : []),
    ].sort()
    out.push(`import { ${authNames.join(', ')} } from '@liche/auth'`)
  }
  if (needsMcpServer(catalog)) {
    out.push(`import { mcpServer } from '@liche/mcp-server'`)
  }
  if (catalog.config) {
    out.push(`import { config as configExtension, configDoctor, files } from '@liche/config'`)
  }
  if (catalog.ops.enabled && catalog.ops.telemetry !== false) {
    out.push(`import { jsonlFileSink, telemetry } from '@liche/telemetry'`)
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
