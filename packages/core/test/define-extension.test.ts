import { describe, expect, test } from 'bun:test'
import { defineCli, defineCommand, defineExtension, defineOutputRenderer, outputControls, run, z } from '../src/index.js'

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
        outputControls({ json: true }),
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
    await run(cli, ['ping', '--json'], { stdout: (chunk) => { stdout += chunk } })
    expect(JSON.parse(stdout)).toEqual({ ok: true })
  })

  test('contributes output renderers selected by --format', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [
        outputControls({ format: true, formats: ['test'] }),
        defineExtension({
          id: 'liche.test-renderer',
          outputRenderers: [
            defineOutputRenderer({
              name: 'test',
              render(value, context) {
                return `${context.stage}:${JSON.stringify(value)}`
              },
            }),
          ],
        }),
      ],
      commands: [
        defineCommand({
          path: ['ping'],
          output: z.object({ ok: z.boolean() }),
          run: () => ({ ok: true }),
        }),
      ],
    })
    let stdout = ''
    await run(cli, ['ping', '--format', 'test'], { stdout: (chunk) => { stdout += chunk } })
    expect(stdout).toBe('result:{"ok":true}\n')
  })

  test('--json resolves the json output renderer from the registry', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [
        outputControls({ json: true }),
        defineExtension({
          id: 'liche.json-renderer',
          outputRenderers: [
            defineOutputRenderer({
              name: 'json',
              render(value, context) {
                return `${context.format}:${JSON.stringify(value)}`
              },
            }),
          ],
        }),
      ],
      commands: [
        defineCommand({
          path: ['ping'],
          output: z.object({ ok: z.boolean() }),
          run: () => ({ ok: true }),
        }),
      ],
    })
    let stdout = ''
    await run(cli, ['ping', '--json'], { stdout: (chunk) => { stdout += chunk } })
    expect(stdout).toBe('json:{"ok":true}\n')
  })
})
