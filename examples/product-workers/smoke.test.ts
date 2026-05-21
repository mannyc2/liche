import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkAgainstDir, generateToDir } from '@lili/product'
import product from './product.js'

type GeneratedCliModule = {
  default: {
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
}

describe('product-workers example', () => {
  let outDir: string

  beforeEach(async () => {
    mkdirSync(join(import.meta.dir, '.tmp'), { recursive: true })
    outDir = mkdtempSync(join(import.meta.dir, '.tmp/generated-'))
    await copyImpl(outDir)
  })

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  test('generates synchronized surfaces', async () => {
    const result = await generateToDir(product, {
      outDir,
      generatorVersion: 'example',
    })

    expect(Object.keys(result.artifacts).sort()).toEqual([
      'agent-reference',
      'cli',
      'command-manifest',
      'config-schema',
      'docs-reference',
      'mcp-tools',
      'openapi',
    ])

    const check = await checkAgainstDir(product, {
      outDir,
      generatorVersion: 'example',
    })
    expect(check).toEqual({ ok: true })
  })

  test('runs local and hybrid commands through generated core CLI', async () => {
    const result = await generateToDir(product, { outDir, generatorVersion: 'example' })
    const cli = await loadGenerated(result.generatedPath)

    const deploy = await runGenerated(cli, [
      'deploy',
      '--entrypoint',
      'src/index.ts',
      '--environment',
      'preview',
      '--json',
    ])
    expect(deploy.exitCode).toBe(0)
    expect(JSON.parse(deploy.stdout)).toMatchObject({
      data: {
        deployment_id: 'dep-src-index-ts-preview',
        url: 'https://preview.workers.example.test',
      },
      meta: { execution: { mode: 'hybrid-workflow', source: 'schema-default' } },
      ok: true,
    })

    const dev = await runGenerated(cli, ['dev', '--entrypoint', 'src/index.ts', '--json'])
    expect(dev.exitCode).toBe(0)
    expect(JSON.parse(dev.stdout)).toMatchObject({
      data: { url: 'http://localhost:8787?entry=src%2Findex.ts' },
      meta: { execution: { mode: 'local', source: 'schema-default' } },
      ok: true,
    })
  })

  test('resource remote transport uses config-backed base URL', async () => {
    const result = await generateToDir(product, { outDir, generatorVersion: 'example' })
    const cli = await loadGenerated(result.generatedPath)
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(new URL(request.url).pathname).toBe('/')
        return Response.json([
          { id: 'worker-a', name: 'Worker A', created_at: '2026-05-20T00:00:00.000Z' },
        ])
      },
    })

    try {
      const configPath = join(outDir, 'workers.jsonc')
      writeFileSync(configPath, JSON.stringify({ apiBaseUrl: server.url.origin }))
      const list = await runGenerated(cli, ['--config', configPath, 'script', 'list', '--json'])
      expect(list.exitCode).toBe(0)
      expect(JSON.parse(list.stdout)).toMatchObject({
        ok: true,
        data: [
          { id: 'worker-a', name: 'Worker A', created_at: '2026-05-20T00:00:00.000Z' },
        ],
        meta: { execution: { mode: 'remote-http', source: 'schema-default' } },
      })
    } finally {
      server.stop(true)
    }
  })
})

async function copyImpl(outDir: string): Promise<void> {
  const implDir = join(outDir, 'impl')
  mkdirSync(implDir, { recursive: true })
  const source = await Bun.file(join(import.meta.dir, 'impl/wrangler.ts')).text()
  writeFileSync(join(implDir, 'wrangler.ts'), source)
}

async function loadGenerated(path: string): Promise<GeneratedCliModule['default']> {
  const mod = (await import(`${path}?t=${Date.now()}`)) as GeneratedCliModule
  return mod.default
}

async function runGenerated(
  cli: GeneratedCliModule['default'],
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
