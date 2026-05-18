import type { CliInstance, ServeOptions } from '../src/index.js'
import { stateSymbol, type InternalCli } from '../src/cli/create.js'

export function stateOf(cli: CliInstance) {
  return (cli as InternalCli)[stateSymbol]
}

export async function runCli(
  cli: CliInstance,
  argv: string[],
  options: Omit<ServeOptions, 'stdout' | 'stderr' | 'exit'> = {},
) {
  let stdout = ''
  let stderr = ''
  let exitCode = 0

  await cli.serve(argv, {
    ...options,
    exit(code) {
      exitCode = code
    },
    stderr(chunk) {
      stderr += chunk
    },
    stdout(chunk) {
      stdout += chunk
    },
  })

  return { exitCode, stderr, stdout }
}

export function parseJsonOutput(stdout: string): any {
  return JSON.parse(stdout.trim())
}
