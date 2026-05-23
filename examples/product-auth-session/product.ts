import { Auth, Command, Field, Runtime, Shape, defineProduct } from '@lili/product'

export default defineProduct({
  id: 'acme-session',
  name: 'Acme Session',
  version: '0.1.0',
  description: 'OAuth device login and file-backed profiles for generated CLIs.',
  remote: { baseUrl: Runtime.literal('https://api.acme.example.test') },
  auth: Auth.oauthDevice({
    id: 'acme',
    token: { kind: 'bearer' },
    clientId: 'acme-cli',
    endpoints: {
      deviceAuthorization: 'https://auth.acme.example.test/device',
      token: 'https://auth.acme.example.test/token',
    },
    sources: [
      Auth.token.env('ACME_TOKEN', { label: 'Bearer token', scopes: ['cache.write'] }),
      Auth.token.env('ACME_CI_TOKEN', { mode: 'ci', scopes: ['cache.write'] }),
      Auth.token.session({ profiles: true }),
    ],
    identity: Auth.identity({ http: { method: 'GET', path: '/me' }, subject: 'id', label: 'email' }),
    commands: Auth.commands({ login: 'login', logout: 'logout', switch: 'switch', whoami: 'whoami' }),
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
      summary: 'Purge cache for an org',
      http: { method: 'POST', path: '/orgs/{org}/purge_cache' },
      output: Shape.object({ purge_id: Field.string('Purge ID') }),
      requires: { auth: true, contexts: ['org'], permissions: ['cache:write'] },
      surfaces: { agent: true },
    }),
  },
})
