import { Auth, Command, Field, Runtime, Shape, defineProduct } from '@liche/product'

export default defineProduct({
  id: 'acme-cache',
  name: 'Acme Cache',
  version: '0.1.0',
  description: 'Cache operations with bearer auth and org context.',
  remote: { baseUrl: Runtime.env('ACME_API_BASE_URL') },
  auth: Auth.bearer({
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
  permissions: {
    'cache:write': Auth.permission.scope('cache.write'),
  },
  contexts: {
    org: Auth.context.env({
      label: 'Organization',
      select: { flag: 'org', env: 'ACME_ORG_ID' },
    }),
  },
  commands: {
    purge: Command.remoteHttp({
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
  },
})
