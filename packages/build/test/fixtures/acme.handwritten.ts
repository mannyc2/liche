import { Cli, z } from '@lili/core'
import { deployProject, getProject } from './impl/projects.js'

const projects = Cli.create('projects')
  .command('get', {
    description: 'Get one project',
    options: z.object({
      includeDeployments: z.boolean().default(false),
      projectId: z.string(),
    }),
    output: z.object({
      project: z.object({ id: z.string(), name: z.string() }),
    }),
    async run(ctx) {
      const data = await getProject(ctx.options)
      return ctx.ok(data, { locality: { mode: 'local', source: 'schema-default' } })
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
