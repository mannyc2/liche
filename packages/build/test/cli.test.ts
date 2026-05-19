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

describe('li-build CLI', () => {
  let dir: string
  const productPath = join(import.meta.dir, 'fixtures/sample-product.ts')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lili-build-cli-'))
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
      generatedPath: join(dir, 'lili.generated.ts'),
      manifestPath: join(dir, 'lili.generated.manifest.json'),
    })
    expect(await Bun.file(data.generatedPath).exists()).toBe(true)
    expect(await Bun.file(data.manifestPath).exists()).toBe(true)
  })

  test('generate --check reports drift as a structured error', async () => {
    const result = await runCli(['generate', productPath, '--out', dir, '--check', '--json'])
    expect(result.exitCode).toBe(1)
    const error = JSON.parse(result.stdout)
    expect(error).toMatchObject({
      code: 'GENERATED_SURFACE_DRIFT',
      message: 'Generated artifacts are out of sync',
    })
    expect(error.hint).toContain('generated file missing')
  })

  test('skills add installs authored li-build guidance', async () => {
    const result = await runCli(['skills', 'add', '--agent', 'claude-code', '--json'], { env: { HOME: dir } })
    expect(result.exitCode).toBe(0)
    const body = JSON.parse(result.stdout)
    expect(body).toEqual({ ok: true, data: { path: join(dir, '.claude/skills/li-build/SKILL.md') } })
    const content = await Bun.file(body.data.path).text()
    expect(content).toContain('description: Author and maintain lili product schemas')
    expect(content).toContain('Product.create(')
    expect(content).toContain('li-build generate <product.ts> --check')
  })

  test('mcp add is enabled for li-build', async () => {
    const result = await runCli(['mcp', 'add', '--agent', 'claude-code', '--json'], { env: { HOME: dir } })
    expect(result.exitCode).toBe(0)
    const body = JSON.parse(result.stdout)
    expect(body).toEqual({ ok: true, data: { path: join(dir, '.claude.json') } })
    const config = await Bun.file(body.data.path).json()
    expect(config.mcpServers['li-build']).toEqual({ args: ['--mcp'], command: 'li-build' })
  })
})
