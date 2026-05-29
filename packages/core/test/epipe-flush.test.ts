import { describe, expect, test } from 'bun:test'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Regression guard for the EPIPE / flush-before-exit fix (terminal.ts writes final
// output synchronously via writeSync, so it flushes fully before process.exit and
// turns a broken pipe into a catchable EPIPE → clean exit). See docs/stdio-primitive-plan.md.
//
// Two bugs this pins, both reproduced on Bun 1.3.9 before the fix (macOS + linux):
//   - `cli … | head`              → was exit 1 + an unhandled "EPIPE: broken pipe" crash.
//   - nonzero-exit + large output → stdout was truncated (eager process.exit beat the async flush).
//
// We spawn a real CLI process and observe its OWN exit code (via bash PIPESTATUS) and
// stderr. Post-fix the behavior is deterministic, so these are ordinary assertions.
// Harness is POSIX-only (bash / PIPESTATUS / head / cat) → skipped on Windows.

const FIXTURE = join(import.meta.dir, 'fixtures', 'epipe-fixture.ts')
const MARK = '<<<END-OF-OUTPUT>>>'

async function bash(script: string): Promise<{ out: string; err: string }> {
  const proc = Bun.spawn(['bash', '-c', script], { stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([
    new Response(proc.stdout as unknown as ReadableStream).text(),
    new Response(proc.stderr as unknown as ReadableStream).text(),
  ])
  await proc.exited
  return { out, err }
}

// A genuine unhandled crash names the error or prints a stack frame; a clean exit prints neither.
function looksLikeCrash(stderr: string): boolean {
  return /EPIPE|Unhandled|unhandledRejection|\bat .+:\d+:\d+/.test(stderr)
}

const suite = process.platform === 'win32' ? describe.skip : describe

suite('EPIPE / flush-before-exit', () => {
  test('`cli flood --json | head` exits cleanly with no unhandled error (broken pipe)', async () => {
    // head reads a little then closes its read end while the CLI is mid-write of ~2MB.
    const { out, err } = await bash(
      `bun "${FIXTURE}" flood --json | head -c 200 > /dev/null; echo "EXIT:\${PIPESTATUS[0]}"`,
    )
    const exit = Number((out.match(/EXIT:(-?\d+)/) ?? [])[1])
    expect(looksLikeCrash(err)).toBe(false)
    expect([0, 141]).toContain(exit) // 0 = graceful, 141 = 128 + SIGPIPE(13)
  })

  test('`cli floodfail --json | cat` flushes the full payload before a nonzero exit (pipe sink)', async () => {
    // floodfail → exitCode 1 → process.exit(1) right after the write; cat drains continuously,
    // so a short capture would mean exit dropped buffered bytes.
    const { out, err } = await bash(
      `bun "${FIXTURE}" floodfail --json | cat; echo "EXIT:\${PIPESTATUS[0]}" 1>&2`,
    )
    const exit = Number((err.match(/EXIT:(-?\d+)/) ?? [])[1])
    expect(exit).toBe(1) // confirms the eager-exit path was exercised
    expect(out.length).toBeGreaterThan(1_000_000) // magnitude bound: not truncated to a pipe-buffer multiple
    expect(out.includes(MARK)).toBe(true) // and the tail specifically survived
  })

  test('`cli floodfail --json > file` flushes the full payload before a nonzero exit (file sink)', async () => {
    const tmp = join(tmpdir(), `epipe-flush-${process.pid}-${Date.now()}.out`)
    const { out } = await bash(`bun "${FIXTURE}" floodfail --json > "${tmp}"; echo "$?"`)
    const exit = Number(out.trim())
    const contents = readFileSync(tmp, 'utf8')
    rmSync(tmp, { force: true })
    expect(exit).toBe(1)
    expect(contents.length).toBeGreaterThan(1_000_000)
    expect(contents.includes(MARK)).toBe(true)
  })
})
