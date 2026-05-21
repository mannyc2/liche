import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
          const body = await request.json() as { environment?: string }
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
    writeFileSync(configPath, `${JSON.stringify({
      apiBaseUrl: server.url.origin,
      defaultProject: 'web',
    }, null, 2)}\n`)
  })

  afterEach(() => {
    server.stop(true)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('is a real handwritten CLI, not only a workflow snippet', async () => {
    const list = await runCli(['--config', configPath, 'deployments', 'list', '--json'])
    expect(list.exitCode).toBe(0)
    expect(JSON.parse(list.stdout)).toEqual([
      {
        id: 'dep_123',
        project: 'web',
        environment: 'staging',
        status: 'ready',
        url: 'https://shipyard.example.com/deployments/dep_123',
      },
    ])

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
      deployment_id: 'dep_123',
      environment: 'production',
      url: 'https://shipyard.example.com/deployments/dep_123',
    })

    const manifest = await runCli(['--llms', '--json'])
    expect(manifest.exitCode).toBe(0)
    expect(JSON.parse(manifest.stdout).commands.map((command: { name: string }) => command.name)).toEqual([
      'deployments list',
      'deployments promote',
    ])
  })
})

async function runCli(argv: string[]): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  let exitCode = 0
  let stderr = ''
  let stdout = ''
  await cli.serve(argv, {
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
