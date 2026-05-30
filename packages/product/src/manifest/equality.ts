import type { GeneratedSurfaceManifest } from './types.js'

export function manifestEqualForSurface(
  expected: GeneratedSurfaceManifest,
  actual: GeneratedSurfaceManifest,
  surfaceId: string,
): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = []
  if (expected.manifestVersion !== actual.manifestVersion) {
    reasons.push(`manifestVersion changed (was ${actual.manifestVersion}, now ${expected.manifestVersion})`)
  }
  if (expected.schema.name !== actual.schema.name) {
    reasons.push(`schema name changed (was ${actual.schema.name}, now ${expected.schema.name})`)
  }
  if (expected.schema.version !== actual.schema.version) {
    reasons.push(`schema version changed (was ${actual.schema.version}, now ${expected.schema.version})`)
  }
  if (expected.schema.digest !== actual.schema.digest) {
    reasons.push(`schema digest changed (was ${actual.schema.digest}, now ${expected.schema.digest})`)
  }
  if (expected.generatorVersion !== actual.generatorVersion) {
    reasons.push(`generatorVersion changed (was ${actual.generatorVersion}, now ${expected.generatorVersion})`)
  }
  if (JSON.stringify(expected.auth) !== JSON.stringify(actual.auth)) {
    reasons.push('manifest auth metadata changed')
  }
  const expectedSurface = expected.surfaces.find((s) => s.id === surfaceId)
  const actualSurface = actual.surfaces.find((s) => s.id === surfaceId)
  if (!expectedSurface || !actualSurface) {
    reasons.push(`surface '${surfaceId}' missing from one side`)
    return { ok: false, reasons }
  }
  if (expectedSurface.inputDigest !== actualSurface.inputDigest) {
    reasons.push(`surface '${surfaceId}' inputDigest changed`)
  }
  if (expectedSurface.source !== actualSurface.source) {
    reasons.push(`surface '${surfaceId}' source changed`)
  }
  if (expectedSurface.generationOptionsDigest !== actualSurface.generationOptionsDigest) {
    reasons.push(`surface '${surfaceId}' generationOptionsDigest changed`)
  }
  if (expectedSurface.outputDigest !== actualSurface.outputDigest) {
    reasons.push(`surface '${surfaceId}' output digest mismatch`)
  }
  if (!stringArraysEqual(expectedSurface.artifacts, actualSurface.artifacts)) {
    reasons.push(`surface '${surfaceId}' artifacts changed`)
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}

function stringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}
