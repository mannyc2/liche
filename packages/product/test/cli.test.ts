import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '@liche/core'
import type { RunOptions } from '@liche/core'
import { cli } from '../src/cli.js'

async function runCli(
  argv: string[],
  options: Omit<RunOptions, 'exit' | 'stderr' | 'stdout'> = {},
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  let exitCode = 0
  let stderr = ''
  let stdout = ''
  await run(cli, argv, {
    ...options,
    exit: (code) => { exitCode = code },
    isTty: options.isTty ?? false,
    stderr: (chunk) => { stderr += chunk },
    stdout: (chunk) => { stdout += chunk },
  })
  return { exitCode, stderr, stdout }
}

describe('liche-product CLI', () => {
  let dir: string
  const productPath = join(import.meta.dir, 'fixtures/workers.product.ts')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liche-product-cli-'))
  })

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true })
  })

  test('generate runs through the core CLI runtime', async () => {
    const result = await runCli(['generate', productPath, '--out', dir, '--json'])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')

    const data = JSON.parse(result.stdout).data
    expect(data).toEqual({
      artifactPaths: {
        'agent-reference': join(dir, 'liche.generated.agent.md'),
        catalog: join(dir, 'liche.generated.catalog.json'),
        cli: join(dir, 'liche.generated.ts'),
        'command-manifest': join(dir, 'liche.generated.commands.json'),
        'config-schema': join(dir, 'liche.generated.config.schema.json'),
        discovery: join(dir, 'liche.generated.discovery.json'),
        'docs-reference': join(dir, 'liche.generated.docs.md'),
        'mcp-tools': join(dir, 'liche.generated.mcp.json'),
        openapi: join(dir, 'liche.generated.openapi.json'),
      },
      compileEntrypointPath: join(dir, 'liche.compile-entry.ts'),
      generatedPath: join(dir, 'liche.generated.ts'),
      manifestPath: join(dir, 'liche.generated.manifest.json'),
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
      ok: false,
      data: null,
      error: {
        code: 'GENERATED_SURFACE_DRIFT',
        code_actions: [{ title: 'Regenerate surfaces', command: `liche-product generate ${productPath}` }],
        message: 'Generated artifacts are out of sync',
        suggested_fix: 'Run generation without --check and commit the updated artifacts.',
      },
    })
    expect(error.error.hint).toContain('generated file missing')
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
      const body = JSON.parse(result.stdout).data
      expect(body.summary).toEqual({ passed: 1, failed: 0, skipped: 0, total: 1 })
      const report = await Bun.file(reportPath).json()
      expect(report.summary).toEqual(body.summary)
      expect(report.cases[0].status).toBe('passed')
    } finally {
      server.stop(true)
    }
  })

  test('conform failure returns structured recovery actions', async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: 'nope' }, { status: 500 })
      },
    })
    const reportPath = join(dir, 'failed-conformance.json')
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
      expect(result.exitCode).toBe(1)
      const body = JSON.parse(result.stdout)
      expect(body).toMatchObject({
        ok: false,
        data: null,
        error: {
          code: 'CONFORMANCE_FAILED',
          code_actions: [{ title: 'Inspect conformance report', command: `cat ${reportPath}` }],
          message: '1 conformance case(s) failed',
          suggested_fix: `Inspect ${reportPath}, fix the failing cases, and rerun conformance.`,
        },
      })
      const report = await Bun.file(reportPath).json()
      expect(report.summary).toEqual({ passed: 0, failed: 1, skipped: 0, total: 1 })
    } finally {
      server.stop(true)
    }
  })

  test('skills add installs authored liche-product guidance', async () => {
    const result = await runCli(['skills', 'add', '--agent', 'claude-code', '--json'], { env: { HOME: dir } })
    expect(result.exitCode).toBe(0)
    const body = JSON.parse(result.stdout).data
    expect(body).toEqual({ path: join(dir, '.claude/skills/liche-product/SKILL.md') })
    const content = await Bun.file(body.path).text()
    expect(content).toContain('description: Author and maintain liche product schemas')
    expect(content).toContain('defineProduct({')
    expect(content).toContain('liche-product generate <product.ts> --check')
  })

  test('mcp add is enabled for liche-product', async () => {
    const result = await runCli(['mcp', 'add', '--agent', 'claude-code', '--json'], { env: { HOME: dir } })
    expect(result.exitCode).toBe(0)
    const body = JSON.parse(result.stdout).data
    expect(body).toEqual({ path: join(dir, '.claude.json') })
    const config = await Bun.file(body.path).json()
    expect(config.mcpServers['liche-product']).toEqual({ args: ['--mcp'], command: 'liche-product' })
  })
})
