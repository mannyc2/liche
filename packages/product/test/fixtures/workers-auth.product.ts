import { Auth, Command, Product, Runtime } from '../../src/index.js'

// Phase 3D-A fixture: a Workers-shaped product with Auth.bearer, one
// remote context with --org/ACME_ORG_ID, and a remote-http command that
// requires both auth and the org context. Used to lock in:
//   - generator emits AUTH_PROVIDER + CONTEXTS constants when needed
//   - context flags appear as required options on the generated command
//   - the run body resolves auth + context before any (still-stub) transport
//   - credentials never leak as raw strings in generated source
export default Product.create({
  id: 'workers-auth',
  name: 'Workers Auth',
  version: '1.0.0',
  description: 'Workers fixture with bearer-token auth and org context.',
})
  .remote({ baseUrl: Runtime.env('ACME_API_BASE_URL') })
  .auth(
    Auth.bearer({
      id: 'acme',
      sources: [
        Auth.token.env('ACME_TOKEN', { label: 'Bearer token' }),
        Auth.token.env('ACME_CI_TOKEN', { mode: 'ci' }),
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
      summary: 'Purge cache for an org',
      http: { method: 'POST', path: '/orgs/{org}/purge_cache', bind: { path: ['org'], body: [] } },
      requires: { auth: true, contexts: ['org'], permissions: ['cache:write'] },
    }),
  )
