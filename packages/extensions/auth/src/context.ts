import { authContextRequired } from './errors.js'
import type { ResolveContextInput } from './types.js'

export async function resolveContext(input: ResolveContextInput): Promise<Record<string, string>> {
  const { contexts, required, explicit = {}, env = {}, providerId = '' } = input
  const resolved: Record<string, string> = {}
  const missing: { id: string; envVar?: string | undefined; flag?: string | undefined }[] = []

  for (const id of required) {
    const ctx = contexts.find((c) => c.id === id)
    if (!ctx) {
      missing.push({ id })
      continue
    }
    const explicitValue = ctx.flag ? explicit[ctx.flag] : undefined
    const envValue = ctx.envVar ? env[ctx.envVar] : undefined
    const storedValue =
      input.profile && (input.credentialSource === 'session' || input.profileExplicit)
        ? input.profile.selectedContexts?.[id]
        : undefined
    const value = explicitValue ?? envValue ?? storedValue
    if (value && value.length > 0) resolved[id] = value
    else missing.push({ id, envVar: ctx.envVar, flag: ctx.flag })
  }

  if (missing.length > 0) throw authContextRequired({ providerId, contexts: missing })
  return resolved
}
