import type { Catalog } from '../catalog/types.js'
import { ID_PATTERN, hasText, type LintIssue } from './types.js'

export function lintProductHeader(catalog: Catalog, issues: LintIssue[]): void {
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

export function lintResources(catalog: Catalog, issues: LintIssue[]): void {
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
}

export function lintConfig(catalog: Catalog, issues: LintIssue[]): void {
  if (!catalog.config) return
  for (const [key, field] of Object.entries(catalog.config.fields.properties)) {
    if (field.secret) {
      issues.push({
        code: 'config/no-secret-fields',
        path: `config.fields.${key}`,
        message: `Config field '${key}' is marked secret; use auth/session or env primitives for credentials`,
      })
    }
  }
  if (catalog.remote?.baseUrl.kind === 'config') {
    const path = catalog.remote.baseUrl.path
    if (!catalog.config.fields.properties[path]) {
      issues.push({
        code: 'catalog/remote-base-url',
        path: 'remote.baseUrl',
        message: `Remote base URL references unknown config field '${path}'`,
      })
    }
  }
}
