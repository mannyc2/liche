import { Cli, z } from '@lili/core'
import { deploy, dev } from './impl/wrangler.js'

const script = Cli.create('script')
  .command('list', {
    options: z.object({}),
    output: z.array(z.object({
      created_at: z.string().optional(),
      id: z.string(),
      name: z.string(),
    })),
    async run(ctx) {
      return ctx.error({
        code: 'REMOTE_NOT_IMPLEMENTED',
        message: 'Remote transport for resource operations is not implemented yet (Phase 4)',
      })
    },
  })

const cli = Cli.create({
  name: 'workers',
  version: '1.0.0',
  generated: { machineOutput: 'envelope', disabledGlobals: ['format'] },
})
  .command(script)
  .command('deploy', {
    options: z.object({
      entrypoint: z.string(),
      environment: z.string().optional(),
    }),
    output: z.object({
      deployment_id: z.string(),
      url: z.string().optional(),
    }),
    async run(ctx) {
      const data = await deploy(ctx.options)
      return ctx.ok(data, { execution: { mode: 'hybrid-workflow', source: 'schema-default' } })
    },
  })
  .command('dev', {
    options: z.object({
      entrypoint: z.string(),
    }),
    output: z.object({
      url: z.string(),
    }),
    async run(ctx) {
      const data = await dev(ctx.options)
      return ctx.ok(data, { execution: { mode: 'local', source: 'schema-default' } })
    },
  })

export default cli
