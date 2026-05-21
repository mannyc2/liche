#!/usr/bin/env bun
import { Cli, middleware, z } from '@lili/core'
import type { CliEvent } from '@lili/core'

export const observedEvents: Array<Pick<CliEvent, 'type' | 'command' | 'result'>> = []

export const cli = Cli.create('notes', {
  builtins: { completions: true, gen: true, mcp: false, skills: false },
  description: 'Handwritten notes CLI example.',
  vars: z.object({
    requestId: z.string().default('unset'),
  }),
  version: '0.1.0',
})
  .on('*', (event) => {
    observedEvents.push({
      command: event.command,
      result: event.result,
      type: event.type,
    })
  })
  .use(middleware(async (ctx, next) => {
    ctx.set('requestId', 'example-request')
    await next()
  }))
  .command('summarize', {
    args: z.object({
      file: z.string(),
    }),
    env: z.object({
      NOTES_TOKEN: z.string().optional(),
    }),
    options: z.object({
      style: z.enum(['brief', 'full']).default('brief'),
    }),
    output: z.object({
      authenticated: z.boolean(),
      file: z.string(),
      requestId: z.string(),
      summary: z.string(),
    }),
    run(ctx) {
      return {
        authenticated: ctx.env.NOTES_TOKEN !== undefined,
        file: ctx.args.file,
        requestId: String(ctx.var.requestId),
        summary: `${ctx.options.style} summary for ${ctx.args.file}`,
      }
    },
  })
  .command('echo', {
    args: z.object({
      message: z.string(),
    }),
    options: z.object({
      shout: z.boolean().default(false),
    }),
    run(ctx) {
      return {
        message: ctx.options.shout ? ctx.args.message.toUpperCase() : ctx.args.message,
      }
    },
  })

if (import.meta.main) await cli.serve(process.argv.slice(2))

