import { formatFailures } from '../internal/failure.js'
import type { PackageReleaseFailure } from '../package/index.js'
import type { ExecuteFailure, PreflightFailure, PublishPlanFailure } from '../publishers/index.js'

export function formatPackageFailures(failures: readonly PackageReleaseFailure[]): string {
  return formatFailures(failures, 'stage')
}

export function formatPlanFailures(failures: readonly PublishPlanFailure[]): string {
  return formatFailures(failures, 'publisher')
}

export function formatPreflightFailures(failures: readonly PreflightFailure[]): string {
  return formatFailures(failures, 'publisher')
}

export function formatExecuteFailure(failure: ExecuteFailure): string {
  return `${failure.stepIndex}/${failure.ecosystem}/${failure.code}: ${failure.message}`
}
