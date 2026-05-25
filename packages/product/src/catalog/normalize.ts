import { normalizeOpsSpec } from '../ops/types.js'
import type { ProductScope, RuntimeProduct } from '../product/types.js'
import type { Vocabulary } from '../schema/vocabulary.js'
import {
  normalizeAuth,
  normalizeAuthCapabilities,
  normalizeContext,
  normalizePermissions,
} from './auth.js'
import {
  normalizeBinding,
  normalizeCommand,
  normalizeResource,
  normalizeResourceOperation,
} from './capabilities.js'
import { normalizeConfig, normalizeRemote } from './config.js'
import type {
  Catalog,
  NormalizedProductScope,
  NormalizedVocabulary,
} from './types.js'

export function normalizeProduct(product: RuntimeProduct): Catalog {
  const auth = normalizeAuth(product.authSpec ?? { kind: 'none' })
  const permissions = normalizePermissions(product.permissionSpecs)
  const permissionIds = new Set(permissions.map((p) => p.id))
  const contexts = product.contexts.map(normalizeContext)
  const contextIds = new Set(contexts.map((c) => c.id))
  const config = product.configSpec ? normalizeConfig(product.configSpec) : undefined
  const remote = product.remoteSpec ? normalizeRemote(product.remoteSpec) : undefined
  const resources = product.resources.map(normalizeResource)
  const resourceCapabilities = product.resources.flatMap((r) =>
    r.operations.map(({ verb, spec }) =>
      normalizeResourceOperation(r.id, verb, spec, auth.kind !== 'none', contextIds, permissionIds),
    ),
  )
  const commandCapabilities = product.commands.map(({ id, spec }) =>
    normalizeCommand(id, spec, auth.kind !== 'none', contextIds, permissionIds),
  )
  const authCapabilities = normalizeAuthCapabilities(auth, contexts)
  const bindings = product.bindings.map(normalizeBinding)
  return {
    kind: 'liche.catalog',
    catalogVersion: 1,
    product: normalizeProductHeader(product),
    vocabulary: normalizeVocabulary(product.vocabulary),
    ops: normalizeOpsSpec(product.opsSpec),
    auth,
    permissions,
    contexts,
    ...(config ? { config } : undefined),
    ...(remote ? { remote } : undefined),
    resources,
    bindings,
    capabilities: [...resourceCapabilities, ...commandCapabilities, ...authCapabilities],
  }
}

function normalizeVocabulary(vocab: Vocabulary): NormalizedVocabulary {
  return {
    verbs: [...vocab.verbs],
    flags: [...vocab.flags],
    aliases: { ...vocab.aliases },
  }
}

function normalizeProductHeader(product: RuntimeProduct): Catalog['product'] {
  const out: Catalog['product'] = {
    id: product.id,
    name: product.name,
    version: product.version,
  }
  if (product.description) out.description = product.description
  if (product.scope) out.scope = normalizeProductScope(product.scope)
  return out
}

function normalizeProductScope(scope: ProductScope): NormalizedProductScope {
  return { kind: scope.kind, param: scope.param }
}
