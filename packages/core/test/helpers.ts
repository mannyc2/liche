import { defineCli, defineCommand } from '../src/index.js'
import type {
  CliExtension,
  CliInstance,
  ConfigDefinition,
  ConfigObjectDefinition,
  ConfigScopesDeclaration,
  DeclarativeCommand,
  Schema,
  ServeOptions,
} from '../src/index.js'
import { stateSymbol, type InternalCli } from '../src/cli/create.js'
import type { CommandDefinition, CreateOptions } from '../src/types.js'

type ConfigFixtureOptions<T> = {
  files?: readonly string[] | undefined
  flag?: string | undefined
  schema?: Schema<T> | undefined
  scopes?: ConfigScopesDeclaration | undefined
}

export function createConfig<T = Record<string, unknown>>(
  options: ConfigFixtureOptions<T> = {},
): ConfigDefinition<T> {
  const out: ConfigObjectDefinition<T> = { kind: 'liche.config.object' }
  if (options.files) out.files = [...options.files]
  if (options.flag) out.flag = options.flag
  if (options.schema) out.schema = options.schema
  if (options.scopes) out.scopes = { ...options.scopes }
  return out
}

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

export function testCommand(path: string | readonly [string, ...string[]], definition: CommandDefinition = {}): DeclarativeCommand {
  const {
    alias,
    aliases,
    args,
    env,
    optionConfig,
    options,
    run,
    ...contract
  } = definition
  return defineCommand({
    ...contract,
    ...(aliases ? { aliases: aliases.map((item) => [item]) } : undefined),
    input: {
      ...(alias ? { aliases: alias } : undefined),
      ...(args ? { args } : undefined),
      ...(optionConfig ? { config: optionConfig } : undefined),
      ...(env ? { env } : undefined),
      ...(options ? { options } : undefined),
    },
    path: Array.isArray(path) ? path : [path],
    ...(run ? { run: (context: any) => run(context.ctx as any) } : undefined),
  } as any)
}

export function testCli(
  nameOrDefinition: string | (CreateOptions & { name: string }),
  definitionOrCommands: CreateOptions | readonly DeclarativeCommand[] = {},
  maybeCommands: readonly DeclarativeCommand[] = [],
): CliInstance {
  const commands = Array.isArray(definitionOrCommands) ? definitionOrCommands : maybeCommands
  const definition = Array.isArray(definitionOrCommands) ? {} : definitionOrCommands
  if (typeof nameOrDefinition === 'string') {
    return defineCli(normalizeTestDefinition({ ...definition, commands, name: nameOrDefinition }))
  }
  return defineCli(normalizeTestDefinition({ ...nameOrDefinition, commands }))
}

function normalizeTestDefinition(definition: CreateOptions & { commands: readonly DeclarativeCommand[]; name: string }) {
  const { config, ...rest } = definition
  const extensions: CliExtension[] = [...((rest as any).extensions ?? [])]
  if (config) extensions.push({ config, id: 'test.config' })
  return {
    ...rest,
    ...(extensions.length ? { extensions } : undefined),
  } as any
}
