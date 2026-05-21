import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

describe('li-build CLI config', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lili-build-cli-'))
  })

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true })
  })

  test('build command consumes explicit Config.object option bindings', async () => {
    const configPath = join(dir, 'li-build.jsonc')
    writeFileSync(configPath, `{
      // Config backs durable build defaults, not release identity.
      "build": {
        "targets": "made-up-target",
        "out": "${join(dir, 'out')}",
        "parallel": false
      }
    }`)

    const result = await runCli([
      '--config',
      configPath,
      'build',
      join(dir, 'entry.ts'),
      '--release-version',
      '1.2.3',
      '--commit',
      '0123456789abcdef',
      '--contract-digest',
      'sha256:contract',
      '--json',
    ])

    expect(result.exitCode).toBe(1)
    const body = JSON.parse(result.stdout)
    expect(body.code).toBe('BUILD_FAILED')
    expect(body.hint).toContain('made-up-target')
    expect(body.hint).toContain('TARGET_RESOLUTION_FAILED')
  })

  test('build command still requires options that are not provided by config', async () => {
    const result = await runCli([
      'build',
      join(dir, 'entry.ts'),
      '--release-version',
      '1.2.3',
      '--commit',
      '0123456789abcdef',
      '--contract-digest',
      'sha256:contract',
      '--json',
    ])

    expect(result.exitCode).toBe(1)
    const body = JSON.parse(result.stdout)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.fieldErrors.some((issue: { path: string }) => issue.path === '$.targets')).toBe(true)
    expect(body.fieldErrors.some((issue: { path: string }) => issue.path === '$.out')).toBe(true)
  })
})
