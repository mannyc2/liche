import { run } from '@liche/core'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cli } from './cli.js'

const DB_PATH = join(tmpdir(), 'liche-core-sqlite-bookmarks-smoke.sqlite')

function cleanup(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${DB_PATH}${suffix}`, { force: true })
  }
}

describe('core-sqlite-bookmarks example', () => {
  beforeEach(cleanup)
  afterAll(cleanup)

  test('add returns the created bookmark in the envelope', async () => {
    const result = await runCli(['add', 'https://bun.sh', '--title', 'Bun', '--tags', 'runtime,docs', '--json'])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: { id: 1, tags: ['runtime', 'docs'], title: 'Bun', url: 'https://bun.sh' },
      error: null,
    })
  })

  test('duplicate url fails with a domain error in the envelope', async () => {
    await runCli(['add', 'https://bun.sh', '--json'])
    const result = await runCli(['add', 'https://bun.sh', '--json'])
    expect(result.exitCode).toBe(1)
    const payload = JSON.parse(result.stdout)
    expect(payload.ok).toBe(false)
    expect(payload.data).toBeNull()
    expect(payload.error.code).toBe('bookmark.duplicate')
  })

  test('list returns persisted rows in id order and filters by tag', async () => {
    await runCli(['add', 'https://bun.sh', '--title', 'Bun', '--tags', 'runtime,docs', '--json'])
    await runCli(['add', 'https://zod.dev', '--tags', 'docs', '--json'])

    const all = JSON.parse((await runCli(['list', '--json'])).stdout)
    expect(all.ok).toBe(true)
    expect(all.data.bookmarks.map((entry: { url: string }) => entry.url)).toEqual([
      'https://bun.sh',
      'https://zod.dev',
    ])

    const runtimeOnly = JSON.parse((await runCli(['list', '--tag', 'runtime', '--json'])).stdout)
    expect(runtimeOnly.data.bookmarks.map((entry: { url: string }) => entry.url)).toEqual(['https://bun.sh'])
  })

  test('remove deletes an existing row and reports missing ids', async () => {
    await runCli(['add', 'https://bun.sh', '--json'])

    const removed = await runCli(['remove', '1', '--json'])
    expect(removed.exitCode).toBe(0)
    expect(JSON.parse(removed.stdout)).toEqual({ ok: true, data: { removed: 1 }, error: null })

    const missing = await runCli(['remove', '1', '--json'])
    expect(missing.exitCode).toBe(1)
    expect(JSON.parse(missing.stdout).error.code).toBe('bookmark.not_found')
  })

  test('help works without acquiring the database resource', async () => {
    const help = await runCli(['--help'], { BOOKMARKS_DB: undefined })
    expect(help.exitCode).toBe(0)
    expect(help.stdout).toContain('add')
    expect(help.stdout).toContain('remove')
  })
})

async function runCli(
  argv: string[],
  env: Record<string, string | undefined> = { BOOKMARKS_DB: DB_PATH },
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
