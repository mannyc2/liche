import { Cli, z } from '@lili/core'
import { deployProject, getProject } from './impl/projects.js'

const projects = Cli.create('projects')
  .command('get', {
    description: 'Get one project',
    options: z.object({
      includeDeployments: z.boolean().default(false),
      local: z.boolean().optional(),
      projectId: z.string(),
      remote: z.boolean().optional(),
    }),
    output: z.object({
      project: z.object({ id: z.string(), name: z.string() }),
    }),
    async run(ctx) {
      if (ctx.options.local === true && ctx.options.remote === true) {
        return ctx.error({ code: 'LOCALITY_CONFLICT', message: '--local and --remote are mutually exclusive' })
      }
      let mode = 'local'
      let source: 'flag' | 'schema-default' = 'schema-default'
      if (ctx.options.local === true) { mode = 'local'; source = 'flag' }
      else if (ctx.options.remote === true) {
        return ctx.error({ code: 'REMOTE_NOT_IMPLEMENTED', message: 'Remote transport is not implemented yet (Phase 4)' })
      }
      const { local: _local, remote: _remote, ...input } = ctx.options
      const data = await getProject(input)
      return ctx.ok(data, { locality: { mode, source } })
    },
  })
  .command('deploy', {
    description: 'Deploy a project (workflow command, not CRUD)',
    options: z.object({
      projectId: z.string(),
      target: z.string().default('preview'),
    }),
    output: z.object({ deploymentId: z.string() }),
    async run(ctx) {
      const data = await deployProject(ctx.options)
      return ctx.ok(data, { locality: { mode: 'local', source: 'schema-default' } })
    },
  })

const program = Cli.create({
  name: 'acme',
  version: '0.1.0',
  generated: { machineOutput: 'envelope', disabledGlobals: ['format'] },
}).command(projects)

export default program
