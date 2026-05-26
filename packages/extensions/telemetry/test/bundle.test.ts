import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

describe('bundle size budget', () => {
  test('minified entry ≤ 25 KB', async () => {
    const pkgRoot = join(import.meta.dir, '..')
    const entry = join(pkgRoot, 'src', 'index.ts')
    const result = await Bun.build({
      entrypoints: [entry],
      minify: true,
      target: 'bun',
      external: ['@liche/core'],
    })
    expect(result.success).toBe(true)
    let bytes = 0
    for (const output of result.outputs) {
      bytes += (await output.text()).length
    }
    if (process.env['TELEMETRY_BUNDLE_LOG']) console.log(`bundle bytes: ${bytes}`)
    expect(bytes).toBeLessThanOrEqual(25 * 1024)
  })
})
