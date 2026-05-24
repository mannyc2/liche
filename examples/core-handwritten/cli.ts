#!/usr/bin/env bun
import { defineCli, defineCommand, middleware, z } from '@liche/core'
import type { CliEvent } from '@liche/core'

export const observedEvents: Array<Pick<CliEvent, 'type' | 'command' | 'result'>> = []

export const cli = defineCli({
  builtins: { completions: true, mcp: false, skills: false },
  events: [(event) => {
    observedEvents.push({
      command: event.command,
      result: event.result,
      type: event.type,
    })
  }],
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
        requestId: z.string(),
        summary: z.string(),
      }),
      run({ ctx, input }) {
        return {
          authenticated: input.env.NOTES_TOKEN !== undefined,
          file: input.args.file,
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
