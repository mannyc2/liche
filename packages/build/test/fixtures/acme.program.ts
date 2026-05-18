import { z } from 'zod'
import { defineProgram, operation } from '../../src/index.js'

export default defineProgram({
  name: 'acme',
  version: '0.1.0',
  operations: [
    operation({
      id: 'projects.get',
      verb: 'get',
      command: ['projects', 'get'],
      description: 'Get one project',
      locality: { modes: ['local'], default: 'local' },
      input: z.object({
        projectId: z.string(),
        includeDeployments: z.boolean().default(false),
      }),
      output: z.object({
        project: z.object({ id: z.string(), name: z.string() }),
      }),
      effects: { kind: 'read' },
      local: { module: './impl/projects.ts', export: 'getProject' },
    }),
    operation({
      id: 'projects.deploy',
      verb: 'run',
      command: ['projects', 'deploy'],
      description: 'Deploy a project (workflow command, not CRUD)',
      locality: { modes: ['local'], default: 'local' },
      input: z.object({
        projectId: z.string(),
        target: z.string().default('preview'),
      }),
      output: z.object({ deploymentId: z.string() }),
      effects: { kind: 'exec' },
      local: { module: './impl/projects.ts', export: 'deployProject' },
    }),
  ],
})
