import { defineCli, defineCommand, outputControls, reflectionControls, run } from '../src/index.js'
import { tokens } from '@liche/tokens'
import type {
  CliExtension,
  CliInstance,
  DeclarativeCommand,
  RunOptions,
} from '../src/index.js'
import { stateSymbol, type InternalCli } from '../src/cli/create.js'
import type { CommandDefinition, CreateOptions } from '../src/types.js'

export function stateOf(cli: CliInstance) {
  return (cli as InternalCli)[stateSymbol]
}

export async function runCli(
  cli: CliInstance,
  argv: string[],
  options: Omit<RunOptions, 'stdout' | 'stderr' | 'exit'> = {},
) {
  let stdout = ''
  let stderr = ''
  let exitCode = 0

  await run(cli, argv, {
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

export function parseJsonData(stdout: string): any {
  const envelope = JSON.parse(stdout.trim())
  if (envelope && typeof envelope === 'object' && 'ok' in envelope && 'data' in envelope) {
    return envelope.data
  }
  return envelope
}

export function testCommand(path: string | readonly [string, ...string[]], definition: CommandDefinition = {}): DeclarativeCommand {
  const {
    alias,
    aliases,
    args,
    env,
    options,
    run,
    sources,
    ...contract
  } = definition
  return defineCommand({
    ...contract,
    ...(aliases ? { aliases: aliases.map((item) => [item]) } : undefined),
    input: {
      ...(alias ? { aliases: alias } : undefined),
      ...(args ? { args } : undefined),
      ...(env ? { env } : undefined),
      ...(options ? { options } : undefined),
      ...(sources ? { sources } : undefined),
    },
    path: Array.isArray(path) ? path : [path],
    ...(run ? { run: (context: any) => run(context.ctx as any) } : undefined),
  } as any)
}

type TestCliDefinition = Omit<CreateOptions, 'name'> & {
  commands?: readonly DeclarativeCommand[]
  extensions?: readonly CliExtension[]
  testControls?: boolean
}

const defaultTestControls = [outputControls(), tokens(), reflectionControls()]

// Built-in help is default-on at the defineCli level; --version registers when a version string is
// set. Mirror the old built-in bundle: testControls → a default version (so --version stays
// registered and listed in help; help is free), no testControls → help:false for a minimal CLI.
function builtinDefaults(testControls: boolean, definition: { version?: string | undefined }) {
  return testControls ? { version: definition.version ?? '0.0.0' } : { help: false }
}

export function testCli(
  nameOrDefinition: string | (TestCliDefinition & { name: string }),
  definitionOrCommands: TestCliDefinition | readonly DeclarativeCommand[] = {},
  maybeCommands: readonly DeclarativeCommand[] = [],
): CliInstance {
  const commands = Array.isArray(definitionOrCommands) ? definitionOrCommands : maybeCommands
  const definition: TestCliDefinition = Array.isArray(definitionOrCommands) ? {} : definitionOrCommands as TestCliDefinition
  const { testControls = true, ...definitionWithoutTestControls } = definition
  const extensions = [
    ...(testControls ? defaultTestControls : []),
    ...(definitionWithoutTestControls.extensions ?? []),
  ]
  const finalDefinition = {
    ...builtinDefaults(testControls, definitionWithoutTestControls),
    ...definitionWithoutTestControls,
    ...(extensions.length ? { extensions } : undefined),
  }
  if (typeof nameOrDefinition === 'string') {
    return defineCli({ ...finalDefinition, commands, name: nameOrDefinition } as any)
  }
  const { testControls: namedTestControls = true, ...namedDefinition } = nameOrDefinition
  const namedExtensions = [
    ...(namedTestControls ? defaultTestControls : []),
    ...(namedDefinition.extensions ?? []),
  ]
  return defineCli({
    ...builtinDefaults(namedTestControls, namedDefinition),
    ...namedDefinition,
    commands,
    ...(namedExtensions.length ? { extensions: namedExtensions } : undefined),
  } as any)
}
