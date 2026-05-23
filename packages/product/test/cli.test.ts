import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServeOptions } from '@lili/core'
import { cli } from '../src/cli.js'

async function runCli(
  argv: string[],
  options: Omit<ServeOptions, 'exit' | 'stderr' | 'stdout'> = {},
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  let exitCode = 0
  let stderr = ''
  let stdout = ''
  await cli.serve(argv, {
    ...options,
    exit: (code) => { exitCode = code },
    isTty: options.isTty ?? false,
    stderr: (chunk) => { stderr += chunk },
    stdout: (chunk) => { stdout += chunk },
  })
  return { exitCode, stderr, stdout }
}

describe('li-product CLI', () => {
  let dir: string
  const productPath = join(import.meta.dir, 'fixtures/workers.product.ts')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lili-product-cli-'))
  })

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true })
  })

  test('generate runs through the core CLI runtime', async () => {
    const result = await runCli(['generate', productPath, '--out', dir, '--json'])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')

    const data = JSON.parse(result.stdout)
    expect(data).toEqual({
      artifactPaths: {
        'agent-reference': join(dir, 'lili.generated.agent.md'),
        catalog: join(dir, 'lili.generated.catalog.json'),
        cli: join(dir, 'lili.generated.ts'),
        'command-manifest': join(dir, 'lili.generated.commands.json'),
        'config-schema': join(dir, 'lili.generated.config.schema.json'),
        discovery: join(dir, 'lili.generated.discovery.json'),
        'docs-reference': join(dir, 'lili.generated.docs.md'),
        'mcp-tools': join(dir, 'lili.generated.mcp.json'),
        openapi: join(dir, 'lili.generated.openapi.json'),
      },
      compileEntrypointPath: join(dir, 'lili.compile-entry.ts'),
      generatedPath: join(dir, 'lili.generated.ts'),
      manifestPath: join(dir, 'lili.generated.manifest.json'),
    })
    expect(await Bun.file(data.compileEntrypointPath).exists()).toBe(true)
    expect(await Bun.file(data.generatedPath).exists()).toBe(true)
    expect(await Bun.file(data.manifestPath).exists()).toBe(true)
    expect(await Bun.file(data.artifactPaths.catalog).exists()).toBe(true)
    expect(await Bun.file(data.artifactPaths.discovery).exists()).toBe(true)
  })

  test('generate --check reports drift as a structured error', async () => {
    const result = await runCli(['generate', productPath, '--out', dir, '--check', '--json'])
    expect(result.exitCode).toBe(1)
    const error = JSON.parse(result.stdout)
    expect(error).toMatchObject({
      code: 'GENERATED_SURFACE_DRIFT',
      code_actions: [{ title: 'Regenerate surfaces', command: `li-product generate ${productPath}` }],
      message: 'Generated artifacts are out of sync',
      suggested_fix: 'Run generation without --check and commit the updated artifacts.',
    })
    expect(error.hint).toContain('generated file missing')
  })

  test('conform runs fixture-server conformance and writes a report', async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json([
          { id: 'script-1', name: 'Worker One', created_at: '2026-05-20T00:00:00.000Z' },
        ])
      },
    })
    const reportPath = join(dir, 'conformance.json')
    try {
      const result = await runCli([
        'conform',
        productPath,
        '--base-url',
        server.url.origin,
        '--capability',
        'script.list',
        '--report',
        reportPath,
        '--json',
      ])
      expect(result.exitCode).toBe(0)
      const body = JSON.parse(result.stdout)
      expect(body.summary).toEqual({ passed: 1, failed: 0, skipped: 0, total: 1 })
      const report = await Bun.file(reportPath).json()
      expect(report.summary).toEqual(body.summary)
      expect(report.cases[0].status).toBe('passed')
    } finally {
      server.stop(true)
    }
  })

  test('skills add installs authored li-product guidance', async () => {
    const result = await runCli(['skills', 'add', '--agent', 'claude-code', '--json'], { env: { HOME: dir } })
    expect(result.exitCode).toBe(0)
    const body = JSON.parse(result.stdout)
    expect(body).toEqual({ ok: true, data: { path: join(dir, '.claude/skills/li-product/SKILL.md') } })
    const content = await Bun.file(body.data.path).text()
    expect(content).toContain('description: Author and maintain lili product schemas')
    expect(content).toContain('defineProduct({')
    expect(content).toContain('li-product generate <product.ts> --check')
  })

  test('mcp add is enabled for li-product', async () => {
    const result = await runCli(['mcp', 'add', '--agent', 'claude-code', '--json'], { env: { HOME: dir } })
    expect(result.exitCode).toBe(0)
    const body = JSON.parse(result.stdout)
    expect(body).toEqual({ ok: true, data: { path: join(dir, '.claude.json') } })
    const config = await Bun.file(body.data.path).json()
    expect(config.mcpServers['li-product']).toEqual({ args: ['--mcp'], command: 'li-product' })
  })
})
