import { Auth, Command, Config, Field, Product, Runtime, Shape } from '@lili/product'

export default Product.create({
  id: 'workers',
  name: 'Workers',
  version: '0.1.0',
  description: 'Build and deploy serverless applications.',
  scope: { kind: 'account', param: 'account_id' },
})
  .auth(Auth.none())
  .config(Config.object({
    files: ['workers.jsonc', 'workers.yaml', 'workers.toml'],
    fields: Shape.object({
      apiBaseUrl: Field.string('API base URL').default('https://api.workers.example.test'),
      accountId: Field.string('Default account ID').optional(),
    }),
    scopes: { project: { discoverUpwards: true }, user: { xdg: true } },
  }))
  .remote({ baseUrl: Runtime.config('apiBaseUrl') })
  .permissions({
    'workers:read': Auth.permission.scope('workers.read'),
    'workers:edit': Auth.permission.scope('workers.edit'),
  })
  .resource(
    'script',
    {
      label: 'Worker script',
      path: '/workers/scripts',
      doc: 'A deployed Worker script.',
      scope: 'account',
    },
    (resource) =>
      resource
        .field('id', Field.string('Script ID').identifier().immutable())
        .field('name', Field.string('Script name').humanLabel())
        .field('created_at', Field.datetime('Creation time').immutable().optional())
        .operation('list', {
          summary: 'List Worker scripts',
          http: { method: 'GET', path: '' },
          output: Shape.list('script'),
          requires: { permissions: ['workers:read'] },
          surfaces: { agent: true },
        }),
  )
  .command(
    'deploy',
    Command.workflow({
      summary: 'Deploy a Worker',
      input: Shape.object({
        entrypoint: Field.string('Entrypoint file'),
        environment: Field.string('Environment').optional().default('preview'),
      }),
      output: Shape.object({
        deployment_id: Field.string('Deployment ID'),
        url: Field.string('Deployment URL').optional(),
      }),
      handler: 'wrangler.deploy',
      steps: [
        { id: 'bundle', label: 'Bundle local source', uses: 'local' },
        { id: 'upload', label: 'Upload assets', uses: 'api' },
      ],
      requires: { permissions: ['workers:edit'] },
      surfaces: {
        agent: true,
        dashboard: { view: 'action', placement: 'page' },
      },
    }),
  )
  .command(
    'dev',
    Command.local({
      summary: 'Run a local development server',
      input: Shape.object({
        entrypoint: Field.string('Entrypoint file'),
        port: Field.int('Port').optional().default(8787),
      }),
      output: Shape.object({ url: Field.string('Local URL') }),
      handler: 'wrangler.dev',
      needs: ['filesystem', 'runtime'],
      surfaces: { agent: false, openapi: false },
    }),
  )
  .binding({
    key: 'kv_namespaces',
    doc: 'KV namespaces bound to the Worker.',
    fields: Shape.object({
      binding: Field.string('Variable name in code'),
      id: Field.string('KV namespace id'),
    }),
  })
