import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { checkAgainstDir, generateToDir } from '@lili/product'
import product from './product.js'

type GeneratedCli = {
  serve: (
    argv: string[],
    options: {
      stdout: (chunk: string) => void
      stderr: (chunk: string) => void
      exit: (code: number) => void
      isTty: boolean
      env?: Record<string, string | undefined>
    },
  ) => Promise<void>
}

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

  test('resolves auth and context before reaching remote transport stub', async () => {
    const result = await generateToDir(product, { outDir, generatorVersion: 'example' })
    const cli = await loadGenerated(result.generatedPath)

    const missingToken = await runGenerated(cli, ['purge', '--zone', 'zone-a', '--org', 'acme', '--json'])
    expect(missingToken.exitCode).toBe(1)
    expect(missingToken.stdout).toContain('AUTH_MISSING')
    expect(missingToken.stdout).not.toContain('REMOTE_NOT_IMPLEMENTED')

    const missingContext = await runGenerated(cli, ['purge', '--zone', 'zone-a', '--json'], {
      ACME_TOKEN: 'tok_example',
    })
    expect(missingContext.exitCode).toBe(1)
    expect(missingContext.stdout).toContain('AUTH_CONTEXT_REQUIRED')

    const resolved = await runGenerated(cli, ['purge', '--zone', 'zone-a', '--json'], {
      ACME_TOKEN: 'tok_example',
      ACME_ORG_ID: 'acme',
    })
    expect(resolved.exitCode).toBe(1)
    expect(resolved.stdout).toContain('REMOTE_NOT_IMPLEMENTED')
    expect(resolved.stdout).not.toContain('tok_example')
  })

  test('uses the CI-only token source when CI=true', async () => {
    const result = await generateToDir(product, { outDir, generatorVersion: 'example' })
    const cli = await loadGenerated(result.generatedPath)

    const resolved = await runGenerated(cli, ['purge', '--zone', 'zone-a', '--json'], {
      CI: 'true',
      ACME_CI_TOKEN: 'tok_ci',
      ACME_ORG_ID: 'acme',
    })
    expect(resolved.exitCode).toBe(1)
    expect(resolved.stdout).toContain('REMOTE_NOT_IMPLEMENTED')
    expect(resolved.stdout).not.toContain('tok_ci')
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
  await cli.serve(argv, {
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
