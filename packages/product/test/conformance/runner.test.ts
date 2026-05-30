import { describe, expect, test } from 'bun:test'
import { Auth, Command, Field, Runtime, Shape, conformProduct, defineProduct } from '../../src/index.js'

function remoteProduct() {
  return defineProduct({
    id: 'remote-fixture',
    name: 'Remote Fixture',
    version: '1.0.0',
    auth: Auth.none(),
    remote: { baseUrl: Runtime.env('REMOTE_FIXTURE_URL') },
    resources: {
      script: {
        label: 'Script',
        path: '/scripts',
        fields: {
          id: Field.string('Script ID').identifier(),
          name: Field.string('Script name'),
        },
        operations: {
          list: {
            summary: 'List scripts',
            effects: { kind: 'read', idempotent: true },
            policy: { conformanceEligible: true },
            examples: [{ command: 'remote-fixture script list --json' }],
            http: { method: 'GET', path: '/scripts' },
            output: Shape.list('script'),
          },
        },
      },
    },
    commands: {
      delete: Command.remoteHttp({
        summary: 'Delete script',
        effects: { kind: 'delete', idempotent: false },
        policy: { dangerous: true, requiresConfirmation: true, conformanceEligible: true },
        examples: [{ command: 'remote-fixture delete --id script-1 --json' }],
        input: Shape.object({ id: Field.string('Script ID') }),
        output: Shape.object({ deleted: Field.boolean('Deleted') }),
        http: { method: 'DELETE', path: '/scripts/{id}', bind: { path: ['id'] } },
      }),
    },
  })
}

function authProduct() {
  return defineProduct({
    id: 'auth-fixture',
    name: 'Auth Fixture',
    version: '1.0.0',
    remote: { baseUrl: Runtime.env('AUTH_FIXTURE_URL') },
    auth: Auth.bearer({ id: 'acme', sources: [Auth.token.env('ACME_TOKEN')] }),
    commands: {
      purge: Command.remoteHttp({
        summary: 'Purge',
        effects: { kind: 'write', idempotent: false },
        policy: { conformanceEligible: true },
        input: Shape.object({
          zone: Field.string('Zone'),
          token: Field.string('Request token'),
        }),
        output: Shape.object({ ok: Field.boolean('OK') }),
        requires: { auth: true },
        http: { method: 'POST', path: '/zones/{zone}/purge', bind: { path: ['zone'], body: ['token'] } },
      }),
    },
  })
}

describe('product conformance', () => {
  test('runs read-only fixture-server cases and skips destructive capabilities by default', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(new URL(request.url).pathname).toBe('/scripts')
        return Response.json([{ id: 'script-1', name: 'Worker One' }])
      },
    })
    try {
      const report = await conformProduct(remoteProduct(), {
        env: { REMOTE_FIXTURE_URL: server.url.origin },
      })
      expect(report.summary).toEqual({ passed: 1, failed: 0, skipped: 1, total: 2 })
      expect(report.cases.map((c) => [c.capability, c.status])).toEqual([
        ['script.list', 'passed'],
        ['delete', 'skipped'],
      ])
      expect(report.cases[0]?.request).toMatchObject({
        method: 'GET',
        url: `${server.url.origin}/scripts`,
      })
    } finally {
      await server.stop(true)
    }
  })

  test('explicit fixtures opt destructive capabilities into conformance', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(request.method).toBe('DELETE')
        expect(new URL(request.url).pathname).toBe('/scripts/script-1')
        return Response.json({ deleted: true })
      },
    })
    try {
      const report = await conformProduct(remoteProduct(), {
        capability: 'delete',
        env: { REMOTE_FIXTURE_URL: server.url.origin },
        includeDestructive: true,
        fixtures: [
          {
            name: 'delete script',
            capability: 'delete',
            input: { id: 'script-1' },
            expectRequest: { method: 'DELETE', path: '/scripts/script-1' },
            expectResponse: { body: { deleted: true } },
          },
        ],
      })
      expect(report.summary).toEqual({ passed: 1, failed: 0, skipped: 0, total: 1 })
    } finally {
      await server.stop(true)
    }
  })

  test('report failures redact auth material from headers and response previews', async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: 'bad token', token: 'secret-token' }, { status: 500 })
      },
    })
    try {
      const report = await conformProduct(authProduct(), {
        env: {
          AUTH_FIXTURE_URL: server.url.origin,
          ACME_TOKEN: 'secret-token',
        },
        fixtures: [
          {
            name: 'purge fails',
            capability: 'purge',
            input: { zone: 'zone-1', token: 'request-secret-token' },
          },
        ],
      })
      expect(report.summary).toEqual({ passed: 0, failed: 1, skipped: 0, total: 1 })
      const text = JSON.stringify(report)
      expect(text).not.toContain('secret-token')
      expect(text).not.toContain('request-secret-token')
      expect(text).toContain('[redacted]')
      expect(report.cases[0]?.request?.headers?.authorization).toBe('[redacted]')
      expect(report.cases[0]?.request?.bodyPreview).toContain('[redacted]')
      expect(report.cases[0]?.errors[0]?.code).toBe('REMOTE_HTTP_STATUS')
    } finally {
      await server.stop(true)
    }
  })
})
