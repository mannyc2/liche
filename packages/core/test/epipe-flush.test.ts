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

// The `i` of each streamed jsonl chunk, in the order it appears in the output.
// streamfail yields i=0..31 in order, so a correct stream is monotonically increasing.
function chunkOrder(jsonl: string): number[] {
  return [...jsonl.matchAll(/"type":"chunk","data":\{"i":(\d+)/g)].map((m) => Number(m[1]))
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
    const { out, err } = await bash(`bun "${FIXTURE}" floodfail --json | cat; echo "EXIT:\${PIPESTATUS[0]}" 1>&2`)
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

  // The STREAMING path (jsonl + async-iterable handler) writes chunks via the async `chunk`
  // writer (`await Bun.stdout.write`), which execute awaits once per chunk — so the writes
  // serialize in yield order and every chunk fully flushes before the run's eager process.exit.
  // A streamed run only reaches a nonzero exit by THROWING after yielding chunks (a non-throwing
  // iterable always resolves to ok(collected)); because the writes are awaited, all yielded
  // chunks are out before the throw drives process.exit(1). These guard that ordering and the
  // full-payload flush, plus the broken-pipe path. `streamfail` yields ~2MB across 32 chunks
  // then throws.

  test('`cli streamfail --format jsonl | cat` streams all 32 chunks IN ORDER before a nonzero exit (pipe sink)', async () => {
    const { out, err } = await bash(
      `bun "${FIXTURE}" streamfail --format jsonl | cat; echo "EXIT:\${PIPESTATUS[0]}" 1>&2`,
    )
    const exit = Number((err.match(/EXIT:(-?\d+)/) ?? [])[1])
    expect(exit).toBe(1) // confirms the eager-exit path was exercised
    expect(out.length).toBeGreaterThan(1_000_000) // not truncated to a pipe-buffer multiple
    expect(out.includes(MARK)).toBe(true) // the final chunk (yielded just before the throw) survived
    // The stream must arrive in yielded order: i=0,1,…,31. Anything else means the async
    // chunk writer let concurrent writes complete out of order (fire-and-forget Bun.stdout.write).
    expect(chunkOrder(out)).toEqual(Array.from({ length: 32 }, (_, i) => i))
  })

  // Regression guard for the chunk write-order fix. Before the fix the async chunk writer
  // (`io.chunk = (s) => void Bun.stdout.write(s)`) did not await the write, so concurrent
  // in-flight writes to a FILE completed out of order and the streamed jsonl arrived scrambled
  // — a RACE, not a fixed scramble: a single run landed in order only ~1 time in 6. Now io.chunk
  // awaits Bun.stdout.write and execute awaits onChunk per chunk, so the writes serialize in
  // yield order. We run the CLI REPEAT times and require every run to be ordered; pre-fix that
  // drove P(accidental all-ordered) ≈ 0.17^REPEAT ≈ 1e-8, so this stays a deterministic catch
  // if the serialization ever regresses. A pipe sink already serializes (see the pipe test
  // above); nothing is ever lost (byte count + MARK survive); the defect this pins is purely ORDER.
  const REPEAT = 10
  const inOrder = Array.from({ length: 32 }, (_, i) => i)
  test(`\`cli streamfail --format jsonl > file\` streams all 32 chunks IN ORDER (file sink, ${REPEAT}×, guards the write-order fix)`, async () => {
    for (let run = 0; run < REPEAT; run++) {
      const tmp = join(tmpdir(), `epipe-stream-${process.pid}-${run}.out`)
      const { out } = await bash(`bun "${FIXTURE}" streamfail --format jsonl > "${tmp}"; echo "$?"`)
      const exit = Number(out.trim())
      const contents = readFileSync(tmp, 'utf8')
      rmSync(tmp, { force: true })
      expect(exit).toBe(1)
      expect(contents.length).toBeGreaterThan(1_000_000) // not truncated
      expect(contents.includes(MARK)).toBe(true) // tail survived
      expect(chunkOrder(contents)).toEqual(inOrder) // ← fails on the first scrambled run
    }
  })

  test('`cli streamfail --format jsonl | head` exits cleanly with no unhandled error (broken pipe on the async chunk path)', async () => {
    const { out, err } = await bash(
      `bun "${FIXTURE}" streamfail --format jsonl | head -c 200 > /dev/null; echo "EXIT:\${PIPESTATUS[0]}"`,
    )
    const exit = Number((out.match(/EXIT:(-?\d+)/) ?? [])[1])
    expect(looksLikeCrash(err)).toBe(false)
    expect([0, 141]).toContain(exit) // 0 = graceful, 141 = 128 + SIGPIPE(13)
  })
})
