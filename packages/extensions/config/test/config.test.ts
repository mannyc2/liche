import { describe, expect, test } from 'bun:test'
import { defineCli, defineCommand, outputControls, run, z } from '@liche/core'
import { config } from '../src/index.js'

describe('@liche/config', () => {
  test('declares core config through the extension lane', async () => {
    const cli = defineCli({
      name: 'ship',
      extensions: [
        outputControls({ json: true }),
        config({
          schema: z.strictObject({
            defaultRegion: z.string().default('iad'),
          }),
        }),
      ],
      commands: [
        defineCommand({
          input: {
            options: z.object({ region: z.string().default('dfw') }),
            sources: { options: { region: [{ provider: 'config', path: 'defaultRegion' }] } },
          },
          path: ['deploy'],
          run({ ctx, input }) {
            return {
              region: input.options.region,
              source: ctx.sources.option('region'),
            }
          },
        }),
      ],
    })

    let stdout = ''
    let exitCode = 0
    await run(cli, ['deploy', '--json'], {
      exit(code) {
        exitCode = code
      },
      stdout(chunk) {
        stdout += chunk
      },
    })

    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      region: 'iad',
      source: { kind: 'provider', provider: 'config', path: 'defaultRegion', source: { kind: 'default' } },
    })
  })
})
