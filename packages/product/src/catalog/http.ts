import type { HttpBind, HttpSpec } from '../command/types.js'
import type { NormalizedHttpBind, NormalizedHttpSpec } from './types.js'

export function normalizeHttpSpec(http: HttpSpec): NormalizedHttpSpec {
  return { method: http.method, path: http.path, bind: normalizeHttpBind(http.bind) }
}

function normalizeHttpBind(bind: HttpBind | undefined): NormalizedHttpBind {
  const raw = bind?.body
  let body: true | string[] | false
  if (raw === undefined || raw === false) body = false
  else if (raw === true) body = true
  else body = [...raw]
  return {
    path: bind?.path ? [...bind.path] : [],
    query: bind?.query ? [...bind.query] : [],
    headers: bind?.headers ? { ...bind.headers } : {},
    body,
  }
}
