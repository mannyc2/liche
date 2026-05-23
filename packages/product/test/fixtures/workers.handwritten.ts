import { defineCli, defineCommand, z } from '@lili/core'
import { deploy, dev } from './impl/wrangler.js'

const cli = defineCli({
  name: 'workers',
  version: '1.0.0',
  generated: { machineOutput: 'envelope', disabledGlobals: ['format'] },
  commands: [
    defineCommand({
      path: ['script', 'list'],
      input: {
        options: z.object({}),
      },
      output: z.array(z.object({
        created_at: z.string().optional(),
        id: z.string(),
        name: z.string(),
      })),
      async run({ ctx }) {
        return ctx.error({
          code: 'REMOTE_NOT_IMPLEMENTED',
          message: 'Remote transport for resource operations is not implemented yet (Phase 4)',
        })
      },
    }),
    defineCommand({
      path: ['deploy'],
      input: {
        options: z.object({
          entrypoint: z.string(),
          environment: z.string().optional(),
        }),
      },
      output: z.object({
        deployment_id: z.string(),
        url: z.string().optional(),
      }),
      async run({ ctx, input }) {
        const data = await deploy(input.options)
        return ctx.ok(data, { execution: { mode: 'hybrid-workflow', source: 'schema-default' } })
      },
    }),
    defineCommand({
      path: ['dev'],
      input: {
        options: z.object({
          entrypoint: z.string(),
        }),
      },
      output: z.object({
        url: z.string(),
      }),
      async run({ ctx, input }) {
        const data = await dev(input.options)
        return ctx.ok(data, { execution: { mode: 'local', source: 'schema-default' } })
      },
    }),
  ],
})

export default cli
