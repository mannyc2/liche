import type { ProductContextEntry } from '../auth/types.js'
import { DEFAULT_GENERATED_VOCABULARY } from '../schema/vocabulary.js'
import type {
  BindingSpec,
  DefinedProduct,
  ProductCommandEntry,
  ProductDefinition,
  ProductResource,
  ProductResourceDefinition,
  ResourceOperationEntry,
} from './types.js'

export function defineProduct(init: ProductDefinition): DefinedProduct {
  const base: DefinedProduct = {
    kind: 'liche.product',
    id: init.id,
    name: init.name,
    version: init.version,
    vocabulary: init.vocabulary ?? DEFAULT_GENERATED_VOCABULARY,
    resources: normalizeResourceDefinitions(init.resources),
    commands: normalizeCommandDefinitions(init.commands),
    bindings: normalizeBindingDefinitions(init.bindings),
    contexts: normalizeContextDefinitions(init.contexts),
    permissionSpecs: { ...(init.permissions ?? {}) },
    ...(init.description ? { description: init.description } : undefined),
    ...(init.scope ? { scope: init.scope } : undefined),
    ...(init.auth ? { authSpec: init.auth } : undefined),
    ...(init.config ? { configSpec: init.config } : undefined),
    ...(init.remote ? { remoteSpec: init.remote } : undefined),
    ...(init.ops ? { opsSpec: init.ops } : undefined),
  }
  return base
}

function normalizeResourceDefinitions(
  resources: ProductDefinition['resources'],
): readonly ProductResource[] {
  if (!resources) return []
  const entries = Array.isArray(resources)
    ? resources.map((resource) => [resource.id, resource] as const)
    : Object.entries(resources)
  return entries.map(([id, resource]) => ({
    id,
    label: resource.label,
    path: resource.path,
    ...(resource.doc ? { doc: resource.doc } : undefined),
    ...(resource.scope ? { scope: resource.scope } : undefined),
    fields: { ...(resource.fields ?? {}) },
    operations: normalizeResourceOperations(resource.operations),
  }))
}

function normalizeResourceOperations(
  operations: ProductResourceDefinition['operations'],
): readonly ResourceOperationEntry[] {
  if (!operations) return []
  return Array.isArray(operations)
    ? operations.map((operation) => ({ verb: operation.verb, spec: operation.spec }))
    : Object.entries(operations).map(([verb, spec]) => ({ verb, spec }))
}

function normalizeCommandDefinitions(
  commands: ProductDefinition['commands'],
): readonly ProductCommandEntry[] {
  if (!commands) return []
  return Array.isArray(commands)
    ? commands.map((command) => ({ id: command.id, spec: command.spec }))
    : Object.entries(commands).map(([id, spec]) => ({ id, spec }))
}

function normalizeBindingDefinitions(
  bindings: ProductDefinition['bindings'],
): readonly BindingSpec[] {
  if (!bindings) return []
  return Array.isArray(bindings)
    ? bindings.map((binding) => ({ ...binding }))
    : Object.entries(bindings).map(([key, binding]) => ({ key, ...binding }))
}

function normalizeContextDefinitions(
  contexts: ProductDefinition['contexts'],
): readonly ProductContextEntry[] {
  if (!contexts) return []
  return Array.isArray(contexts)
    ? contexts.map((context) => ({ id: context.id, spec: context.spec }))
    : Object.entries(contexts).map(([id, spec]) => ({ id, spec }))
}
