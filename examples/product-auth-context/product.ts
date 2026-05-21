import { Auth, Command, Field, Product, Shape } from '@lili/product'

export default Product.create({
  id: 'acme-cache',
  name: 'Acme Cache',
  version: '0.1.0',
  description: 'Cache operations with bearer auth and org context.',
})
  .auth(
    Auth.bearer({
      id: 'acme',
      sources: [
        Auth.token.env('ACME_TOKEN', {
          label: 'Bearer token',
          scopes: ['cache.write'],
        }),
        Auth.token.env('ACME_CI_TOKEN', {
          label: 'CI bearer token',
          mode: 'ci',
          scopes: ['cache.write'],
        }),
      ],
    }),
  )
  .permissions({
    'cache:write': Auth.permission.scope('cache.write'),
  })
  .context(
    'org',
    Auth.context.env({
      label: 'Organization',
      select: { flag: 'org', env: 'ACME_ORG_ID' },
    }),
  )
  .command(
    'purge',
    Command.remoteHttp({
      summary: 'Purge a cache zone',
      input: Shape.object({
        zone: Field.string('Cache zone'),
        reason: Field.string('Audit reason').optional(),
      }),
      output: Shape.object({
        purge_id: Field.string('Purge ID'),
      }),
      http: {
        method: 'POST',
        path: '/orgs/{org}/zones/{zone}/purge',
        bind: { path: ['org', 'zone'], body: ['reason'] },
      },
      requires: {
        auth: true,
        contexts: ['org'],
        permissions: ['cache:write'],
      },
      surfaces: { agent: true },
    }),
  )

