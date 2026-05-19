import type {
  Capability,
  Catalog,
  CommandCapability,
  NormalizedShape,
  ResourceOperationCapability,
} from './catalog.js'

export type LintIssue = {
  code: string
  path: string
  message: string
  recommendation?: string
}

const ID_PATTERN = /^[a-z][a-zA-Z0-9]*(?:[.-][a-z][a-zA-Z0-9]*)*$/

export function lintCatalog(catalog: Catalog): LintIssue[] {
  const issues: LintIssue[] = []
  lintProductHeader(catalog, issues)
  catalog.resources.forEach((resource, index) => {
    const path = `resources[${index}]`
    if (!hasText(resource.path)) {
      issues.push({
        code: 'resource/path-required',
        path: `${path}.path`,
        message: `Resource '${resource.id}' must declare a non-empty path`,
      })
    }
    if (!ID_PATTERN.test(resource.id)) {
      issues.push({
        code: 'resource/id-stable',
        path: `${path}.id`,
        message: `Resource id '${resource.id}' does not match the stable id pattern`,
      })
    }
  })

  const resourceIds = new Set(catalog.resources.map((r) => r.id))
  catalog.capabilities.forEach((cap, index) => lintCapability(cap, index, catalog, resourceIds, issues))
  return issues
}

function lintProductHeader(catalog: Catalog, issues: LintIssue[]): void {
  if (!hasText(catalog.product.id)) {
    issues.push({
      code: 'product/id-required',
      path: 'product.id',
      message: 'Product id must be a non-empty string',
    })
  } else if (!ID_PATTERN.test(catalog.product.id)) {
    issues.push({
      code: 'product/id-stable',
      path: 'product.id',
      message: `Product id '${catalog.product.id}' does not match the stable id pattern`,
    })
  }
  if (!hasText(catalog.product.version)) {
    issues.push({
      code: 'product/version-required',
      path: 'product.version',
      message: 'Product version must be a non-empty string',
    })
  }
}

function lintCapability(
  cap: Capability,
  index: number,
  catalog: Catalog,
  resourceIds: Set<string>,
  issues: LintIssue[],
): void {
  const base = `capabilities[${index}]`
  if (cap.kind === 'resource-operation') {
    lintResourceOperation(cap, base, catalog, issues)
  } else {
    lintCommand(cap, base, catalog, issues)
  }
  if (cap.input) lintShapeReferences(cap.input, `${base}.input`, resourceIds, issues)
  if (cap.kind === 'resource-operation') {
    lintShapeReferences(cap.output, `${base}.output`, resourceIds, issues)
  } else if (cap.output) {
    lintShapeReferences(cap.output, `${base}.output`, resourceIds, issues)
  }
}

function lintResourceOperation(
  cap: ResourceOperationCapability,
  base: string,
  catalog: Catalog,
  issues: LintIssue[],
): void {
  const vocab = catalog.vocabulary
  if (!vocab.verbs.includes(cap.verb)) {
    issues.push({
      code: 'vocabulary/verb',
      path: `${base}.verb`,
      message: `Resource operation verb '${cap.verb}' is not in the product vocabulary`,
      recommendation: `add '${cap.verb}' to vocabulary({ verbs: [...] }) or use one of: ${vocab.verbs.join(', ')}`,
    })
  }
  if (!isNonEmptyShape(cap.output)) {
    issues.push({
      code: 'operation/output-required',
      path: `${base}.output`,
      message: `Resource operation '${cap.id}' must declare a non-empty output schema`,
    })
  }
}

function lintCommand(
  cap: CommandCapability,
  base: string,
  _catalog: Catalog,
  issues: LintIssue[],
): void {
  if (!ID_PATTERN.test(cap.id)) {
    issues.push({
      code: 'command/id-stable',
      path: `${base}.id`,
      message: `Command id '${cap.id}' does not match the stable id pattern`,
    })
  }
  // execution coherence: detect authoring intent that normalization
  // erases (e.g., openapi=true on a local command silently becomes false).
  if (cap.execution.mode === 'local' && cap.surfaces.openapiRequested === true) {
    issues.push({
      code: 'surface/openapi-on-local',
      path: `${base}.surfaces.openapi`,
      message: `Local command '${cap.id}' must not appear in OpenAPI; remove surfaces.openapi or change execution mode`,
    })
  }
  if (
    cap.execution.mode === 'hybrid-workflow' &&
    cap.surfaces.openapiRequested === true &&
    !cap.execution.http
  ) {
    issues.push({
      code: 'command/execution-coherent',
      path: `${base}.execution.http`,
      message: `Hybrid-workflow command '${cap.id}' opted into OpenAPI but has no http trigger`,
      recommendation: 'declare http: { method, path } on the workflow or set surfaces.openapi=false',
    })
  }
}

function lintShapeReferences(
  shape: NormalizedShape,
  path: string,
  resourceIds: Set<string>,
  issues: LintIssue[],
): void {
  if (shape.kind !== 'list') return
  if (!resourceIds.has(shape.resourceId)) {
    issues.push({
      code: 'shape/unknown-resource-ref',
      path,
      message: `Shape.list references unknown resource '${shape.resourceId}'`,
      recommendation: 'declare the resource with Product.create(...).resource(id, ...) or fix the reference',
    })
  }
}

function isNonEmptyShape(shape: NormalizedShape): boolean {
  if (shape.kind === 'list') return true
  return Object.keys(shape.properties).length > 0
}

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}
