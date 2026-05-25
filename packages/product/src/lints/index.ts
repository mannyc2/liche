import type { Catalog } from '../catalog/types.js'
import { lintCapabilities } from './capability.js'
import { lintConfig, lintProductHeader, lintResources } from './product.js'
import type { LintIssue } from './types.js'

export type { LintIssue } from './types.js'

export function lintCatalog(catalog: Catalog): LintIssue[] {
  const issues: LintIssue[] = []
  lintProductHeader(catalog, issues)
  lintConfig(catalog, issues)
  lintResources(catalog, issues)
  lintCapabilities(catalog, issues)
  return issues
}
