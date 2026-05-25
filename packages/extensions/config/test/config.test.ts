import { describe, expect, test } from 'bun:test'
import { defineCli, defineCommand, z } from '@liche/core'
import { config } from '../src/index.js'

describe('@liche/config', () => {
  test('declares core config through the extension lane', async () => {
    const cli = defineCli({
      name: 'ship',
      extensions: [
        config({
          schema: z.strictObject({
            defaultRegion: z.string().default('iad'),
          }),
        }),
      ],
      commands: [
        defineCommand({
          input: {
            config: { region: 'defaultRegion' },
            options: z.object({ region: z.string().default('dfw') }),
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
    await cli.serve(['deploy', '--json'], {
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
      source: 'default',
    })
  })
})
