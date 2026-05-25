#!/usr/bin/env bun
import { defineCli, defineCommand, defineGlobal, help, middleware, outputControls, reflectionControls, version, z } from '@liche/core'
import type { CliEvent } from '@liche/core'
import { completions } from '@liche/extensions'

export const observedEvents: Array<Pick<CliEvent, 'type' | 'command' | 'result'>> = []

const profile = defineGlobal({
  description: 'Profile to use',
  key: 'profile',
  type: 'string',
  valueLabel: 'name',
})

export const cli = defineCli({
  events: [(event) => {
    observedEvents.push({
      command: event.command,
      result: event.result,
      type: event.type,
    })
  }],
  extensions: [help(), version(), outputControls(), reflectionControls(), completions()],
  globals: [profile],
  middleware: [middleware(async (ctx, next) => {
    ctx.set('requestId', 'example-request')
    await next()
  })],
  commands: [
    defineCommand({
      path: ['summarize'],
      input: {
        args: z.object({
          file: z.string(),
        }),
        env: z.object({
          NOTES_TOKEN: z.string().optional(),
        }),
        options: z.object({
          style: z.enum(['brief', 'full']).default('brief'),
        }),
      },
      output: z.object({
        authenticated: z.boolean(),
        file: z.string(),
        profile: z.string().optional(),
        requestId: z.string(),
        summary: z.string(),
      }),
      run({ ctx, input }) {
        return {
          authenticated: input.env.NOTES_TOKEN !== undefined,
          file: input.args.file,
          profile: typeof ctx.global.profile === 'string' ? ctx.global.profile : undefined,
          requestId: String(ctx.var.requestId),
          summary: `${input.options.style} summary for ${input.args.file}`,
        }
      },
    }),
    defineCommand({
      path: ['echo'],
      input: {
        args: z.object({
          message: z.string(),
        }),
        options: z.object({
          shout: z.boolean().default(false),
        }),
      },
      run({ input }) {
        return {
          message: input.options.shout ? input.args.message.toUpperCase() : input.args.message,
        }
      },
    }),
  ],
  description: 'Handwritten notes CLI example.',
  name: 'notes',
  vars: z.object({
    requestId: z.string().default('unset'),
  }),
  version: '0.1.0',
})

if (import.meta.main) await cli.serve(process.argv.slice(2))
