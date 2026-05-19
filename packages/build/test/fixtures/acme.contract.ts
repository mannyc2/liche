import { z } from 'zod'
import { Contract, vocabulary } from '../../src/index.js'

export default Contract.create({
  name: 'acme',
  version: '0.1.0',
  vocabulary: vocabulary({ verbs: ['deploy'] }),
})
  .operation({
    id: 'projects.get',
    command: ['projects', 'get'],
    description: 'Get one project',
    locality: { modes: ['local', 'remote'], default: 'local' },
    input: z.object({
      projectId: z.string(),
      includeDeployments: z.boolean().default(false),
    }),
    output: z.object({
      project: z.object({ id: z.string(), name: z.string() }),
    }),
    effects: { kind: 'read' },
    local: { module: './impl/projects.ts', export: 'getProject' },
    remote: {
      method: 'GET',
      path: '/projects/{projectId}',
      bind: { path: ['projectId'], query: ['includeDeployments'] },
    },
  })
  .operation({
    id: 'projects.deploy',
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
  })
