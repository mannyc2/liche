import { describe, expect, test } from 'bun:test'
import { defineCli, defineCommand, help as helpControl, outputControls, run, z } from '@liche/core'
import { auth } from '../src/index.js'

describe('@liche/auth', () => {
  test('declares auth globals through the extension lane', async () => {
    const cli = defineCli({
      name: 'ship',
      extensions: [helpControl(), outputControls({ json: true }), auth()],
      commands: [
        defineCommand({
          output: z.object({
            noSession: z.boolean().optional(),
            nonInteractive: z.boolean().optional(),
            profile: z.string().optional(),
          }),
          path: ['show'],
          run({ ctx }) {
            return {
              noSession: ctx.global.noSession,
              nonInteractive: ctx.global.nonInteractive,
              profile: ctx.global.profile,
            }
          },
        }),
      ],
    })

    let stdout = ''
    let exitCode = 0
    await run(cli, ['show', '--profile', 'work', '--non-interactive', '--no-session', '--json'], {
      exit(code) {
        exitCode = code
      },
      stdout(chunk) {
        stdout += chunk
      },
    })

    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout).data).toEqual({
      noSession: true,
      nonInteractive: true,
      profile: 'work',
    })

    let help = ''
    await run(cli, ['--help'], {
      stdout(chunk) {
        help += chunk
      },
    })
    expect(help).toContain('--profile <name>')
    expect(help).toContain('--non-interactive')
    expect(help).toContain('--no-session')
  })
})
