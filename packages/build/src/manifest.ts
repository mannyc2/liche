import { createHash } from 'node:crypto'

export type GeneratedSurfaceManifest = {
  manifestVersion: 1
  schema: {
    name: string
    version: string
    digest: string
  }
  generatorVersion: string
  surfaces: Array<{
    id: string
    source: 'catalog' | 'openapi'
    inputDigest: string
    generationOptionsDigest: string
    outputDigest: string
    artifacts: string[]
  }>
}

export function hashString(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`
}

export function manifestEqualForSurface(
  expected: GeneratedSurfaceManifest,
  actual: GeneratedSurfaceManifest,
  surfaceId: string,
): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = []
  if (expected.schema.digest !== actual.schema.digest) {
    reasons.push(`schema digest changed (was ${actual.schema.digest}, now ${expected.schema.digest})`)
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
  if (expectedSurface.generationOptionsDigest !== actualSurface.generationOptionsDigest) {
    reasons.push(`surface '${surfaceId}' generationOptionsDigest changed`)
  }
  if (expectedSurface.outputDigest !== actualSurface.outputDigest) {
    reasons.push(`surface '${surfaceId}' output digest mismatch`)
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}
