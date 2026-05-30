import { run } from '@liche/core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCompilePlan } from '@liche/build'
import { cli } from './src/cli.js'

describe('ci release example', () => {
  let tmpDir: string
  let configPath: string
  let server: ReturnType<typeof Bun.serve>

  beforeEach(() => {
    mkdirSync(join(import.meta.dir, '.tmp'), { recursive: true })
    tmpDir = mkdtempSync(join(import.meta.dir, '.tmp/run-'))
    server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url)
        if (url.pathname === '/deployments' && request.method === 'GET') {
          return Response.json([
            {
              id: 'dep_123',
              project: url.searchParams.get('project') ?? 'unknown',
              environment: 'staging',
              status: 'ready',
              url: 'https://shipyard.example.com/deployments/dep_123',
            },
          ])
        }
        if (url.pathname === '/deployments/dep_123/promote' && request.method === 'POST') {
          const body = (await request.json()) as { environment?: string }
          return Response.json({
            deployment_id: 'dep_123',
            environment: body.environment ?? 'staging',
            url: 'https://shipyard.example.com/deployments/dep_123',
          })
        }
        return new Response('not found', { status: 404 })
      },
    })
    configPath = join(tmpDir, 'shipyard.jsonc')
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          apiBaseUrl: server.url.origin,
          defaultProject: 'web',
        },
        null,
        2,
      )}\n`,
    )
  })

  afterEach(() => {
    server.stop(true)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('is a real handwritten CLI, not only a workflow snippet', async () => {
    const list = await runCli(['--config', configPath, 'deployments', 'list', '--json'])
    expect(list.exitCode).toBe(0)
    expect(JSON.parse(list.stdout)).toEqual({
      ok: true,
      data: [
        {
          id: 'dep_123',
          project: 'web',
          environment: 'staging',
          status: 'ready',
          url: 'https://shipyard.example.com/deployments/dep_123',
        },
      ],
      error: null,
    })

    const promote = await runCli([
      '--config',
      configPath,
      'deployments',
      'promote',
      'dep_123',
      '--environment',
      'production',
      '--json',
    ])
    expect(promote.exitCode).toBe(0)
    expect(JSON.parse(promote.stdout)).toEqual({
      ok: true,
      data: {
        deployment_id: 'dep_123',
        environment: 'production',
        url: 'https://shipyard.example.com/deployments/dep_123',
      },
      error: null,
    })

    const manifest = await runCli(['--llms', '--json'])
    expect(manifest.exitCode).toBe(0)
    expect(JSON.parse(manifest.stdout).commands.map((command: { name: string }) => command.name)).toEqual([
      'deployments list',
      'deployments promote',
      'completions',
      'config doctor',
    ])
  })

  test('documents a package-boundary compile plan through @liche/build', () => {
    const plan = createCompilePlan({
      entrypoint: join(import.meta.dir, 'src/cli.ts'),
      outfile: join(tmpDir, 'shipyard'),
      target: 'bun-linux-x64',
      constants: {
        releaseVersion: '0.1.0',
        contractDigest: 'sha256:example',
        sourceCommit: '0000000',
        buildToolVersion: '0.0.0',
      },
      metafile: true,
    })

    expect(plan.flags).toMatchObject({
      target: 'bun-linux-x64',
      minify: true,
      sourcemap: 'linked',
      bytecode: true,
      packages: 'bundle',
    })
    expect(plan.buildOptions).toMatchObject({
      entrypoints: [join(import.meta.dir, 'src/cli.ts')],
      compile: {
        outfile: join(tmpDir, 'shipyard'),
        target: 'bun-linux-x64',
      },
      metafile: true,
    })
    expect(plan.compileFlagsDigest).toMatch(/^sha256:/)
  })
})

async function runCli(argv: string[]): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  let exitCode = 0
  let stderr = ''
  let stdout = ''
  await run(cli, argv, {
    exit: (code) => {
      exitCode = code
    },
    streams: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    stderr: (chunk) => {
      stderr += chunk
    },
    stdout: (chunk) => {
      stdout += chunk
    },
  })
  return { exitCode, stderr, stdout }
}
