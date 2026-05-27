import { run, type CliInstance } from '@liche/core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { checkAgainstDir, generateToDir } from '@liche/product'
import product from './product.js'

type GeneratedCli = CliInstance

describe('product-auth-context example', () => {
  let outDir: string

  beforeEach(() => {
    mkdirSync(join(import.meta.dir, '.tmp'), { recursive: true })
    outDir = mkdtempSync(join(import.meta.dir, '.tmp/generated-'))
  })

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  test('generates surfaces with non-secret auth metadata', async () => {
    const result = await generateToDir(product, { outDir, generatorVersion: 'example' })
    const check = await checkAgainstDir(product, { outDir, generatorVersion: 'example' })
    expect(check).toEqual({ ok: true })

    const commands = JSON.parse(result.artifacts['command-manifest']!.contents)
    const purge = commands.commands.find((command: { id: string }) => command.id === 'purge')
    expect(purge.auth).toMatchObject({
      required: true,
      providerId: 'acme',
      envVars: ['ACME_TOKEN', 'ACME_CI_TOKEN'],
      requiredScopes: ['cache.write'],
    })

    const source = result.generatedSource
    expect(source).toContain('ACME_TOKEN')
    expect(source).not.toContain('tok_example')
  })

  test('resolves auth and context before calling remote transport', async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        expect(request.method).toBe('POST')
        expect(new URL(request.url).pathname).toBe('/orgs/acme/zones/zone-a/purge')
        expect(request.headers.get('authorization')).toBe('Bearer tok_example')
        expect(await request.json()).toEqual({ reason: 'smoke' })
        return Response.json({ purge_id: 'purge-zone-a' })
      },
    })
    const result = await generateToDir(product, { outDir, generatorVersion: 'example' })
    const cli = await loadGenerated(result.generatedPath)

    try {
      const missingToken = await runGenerated(cli, ['purge', '--zone', 'zone-a', '--org', 'acme', '--json'])
      expect(missingToken.exitCode).toBe(1)
      expect(missingToken.stdout).toContain('AUTH_MISSING')
      expect(missingToken.stdout).not.toContain('REMOTE_CONFIG_MISSING_BASE_URL')

      const missingContext = await runGenerated(cli, ['purge', '--zone', 'zone-a', '--json'], {
        ACME_TOKEN: 'tok_example',
      })
      expect(missingContext.exitCode).toBe(1)
      expect(missingContext.stdout).toContain('AUTH_CONTEXT_REQUIRED')

      const resolved = await runGenerated(cli, ['purge', '--zone', 'zone-a', '--reason', 'smoke', '--json'], {
        ACME_API_BASE_URL: server.url.origin,
        ACME_TOKEN: 'tok_example',
        ACME_ORG_ID: 'acme',
      })
      expect(resolved.exitCode).toBe(0)
      const body = JSON.parse(resolved.stdout)
      expect(body.data).toEqual({ purge_id: 'purge-zone-a' })
      expect(body.meta).toEqual({ execution: { mode: 'remote-http', source: 'env' } })
      expect(resolved.stdout).not.toContain('tok_example')
    } finally {
      server.stop(true)
    }
  })

  test('uses the CI-only token source when CI=true', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(request.headers.get('authorization')).toBe('Bearer tok_ci')
        return Response.json({ purge_id: 'purge-ci' })
      },
    })
    const result = await generateToDir(product, { outDir, generatorVersion: 'example' })
    const cli = await loadGenerated(result.generatedPath)

    try {
      const resolved = await runGenerated(cli, ['purge', '--zone', 'zone-a', '--json'], {
        CI: 'true',
        ACME_API_BASE_URL: server.url.origin,
        ACME_CI_TOKEN: 'tok_ci',
        ACME_ORG_ID: 'acme',
      })
      expect(resolved.exitCode).toBe(0)
      expect(JSON.parse(resolved.stdout).data).toEqual({ purge_id: 'purge-ci' })
      expect(resolved.stdout).not.toContain('tok_ci')
    } finally {
      server.stop(true)
    }
  })
})

async function loadGenerated(path: string): Promise<GeneratedCli> {
  const mod = (await import(`${path}?t=${Date.now()}`)) as { default: GeneratedCli }
  return mod.default
}

async function runGenerated(
  cli: GeneratedCli,
  argv: string[],
  env: Record<string, string | undefined> = {},
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  let exitCode = 0
  let stderr = ''
  let stdout = ''
  await run(cli, argv, {
    env,
    exit: (code) => {
      exitCode = code
    },
    isTty: false,
    stderr: (chunk) => {
      stderr += chunk
    },
    stdout: (chunk) => {
      stdout += chunk
    },
  })
  return { exitCode, stderr, stdout }
}
