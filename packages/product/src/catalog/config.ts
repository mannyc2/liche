import type { ProductConfigSpec } from '../config/create.js'
import type { ProductRemoteSpec } from '../runtime/runtime.js'
import type { RuntimeValueSpec } from '../runtime/runtime.js'
import { normalizeShape } from './shape.js'
import type { NormalizedConfig, NormalizedConfigScopes, NormalizedRemote, NormalizedRuntimeValue } from './types.js'

export function normalizeConfig(config: ProductConfigSpec): NormalizedConfig {
  const fields = normalizeShape(config.fields)
  if (fields.kind !== 'object') {
    throw new Error(`Product config fields must be Shape.object(), got Shape.list`)
  }
  return {
    files: config.files ? [...config.files] : [],
    scopes: normalizeConfigScopes(config),
    fields,
  }
}

function normalizeConfigScopes(config: ProductConfigSpec): NormalizedConfigScopes {
  const project = config.scopes?.project
  const user = config.scopes?.user
  return {
    project:
      project === false
        ? false
        : { discoverUpwards: project === true || (typeof project === 'object' && project.discoverUpwards === true) },
    user: user === true || (typeof user === 'object' && user.xdg === true) ? { xdg: true } : false,
  }
}

export function normalizeRemote(remote: ProductRemoteSpec): NormalizedRemote {
  return { baseUrl: normalizeRuntimeValue(remote.baseUrl) }
}

export function normalizeRuntimeValue(value: RuntimeValueSpec): NormalizedRuntimeValue {
  if (value.kind === 'literal') return { kind: 'literal', value: value.value }
  if (value.kind === 'env') {
    const out: NormalizedRuntimeValue = { kind: 'env', envVar: value.envVar }
    if (value.fallback !== undefined) out.fallback = value.fallback
    return out
  }
  return { kind: 'config', path: value.path }
}
