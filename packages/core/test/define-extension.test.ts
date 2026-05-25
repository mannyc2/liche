import { describe, expect, test } from 'bun:test'
import { defineCli, defineCommand, defineExtension, z } from '../src/index.js'

describe('defineExtension', () => {
  test('returns the input and freezes the result', () => {
    const ext = defineExtension({
      id: 'liche.tenant',
      globals: [{ key: 'tenant', flag: 'tenant', type: 'string', description: 'Tenant id' }],
    })
    expect(ext.id).toBe('liche.tenant')
    expect(Object.isFrozen(ext)).toBe(true)
  })

  test('plugs into defineCli unchanged', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [
        defineExtension({
          id: 'liche.demo',
          commands: [
            defineCommand({
              path: ['ping'],
              output: z.object({ ok: z.boolean() }),
              run: () => ({ ok: true }),
            }),
          ],
        }),
      ],
    })
    let stdout = ''
    await cli.serve(['ping', '--json'], { stdout: (chunk) => { stdout += chunk } })
    expect(JSON.parse(stdout)).toEqual({ ok: true })
  })
})
