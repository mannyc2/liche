import { defineCli, defineCommand, getCliState } from '@liche/core'
import type { CliInstance, DeclarativeCommand } from '@liche/core'

type CmdDef = {
  alias?: any
  aliases?: any
  args?: any
  env?: any
  options?: any
  run?: ((ctx: any) => any) | undefined
  [key: string]: any
}

export function stateOf(cli: CliInstance) {
  return getCliState(cli)
}

export function testCommand(path: string | readonly [string, ...string[]], definition: CmdDef = {}): DeclarativeCommand {
  const { alias, aliases, args, env, options, run, ...contract } = definition
  return defineCommand({
    ...contract,
    ...(aliases ? { aliases: aliases.map((item: string) => [item]) } : undefined),
    input: {
      ...(alias ? { aliases: alias } : undefined),
      ...(args ? { args } : undefined),
      ...(env ? { env } : undefined),
      ...(options ? { options } : undefined),
    },
    path: Array.isArray(path) ? path : [path],
    ...(run ? { run: (context: any) => run(context.ctx as any) } : undefined),
  } as any)
}

export function testCli(
  nameOrDefinition: string | (Record<string, any> & { name: string }),
  definitionOrCommands: any = {},
  maybeCommands: readonly DeclarativeCommand[] = [],
): CliInstance {
  const commands = Array.isArray(definitionOrCommands) ? definitionOrCommands : maybeCommands
  const definition = Array.isArray(definitionOrCommands) ? {} : definitionOrCommands
  if (typeof nameOrDefinition === 'string') {
    return defineCli({ ...definition, commands, name: nameOrDefinition } as any)
  }
  return defineCli({ ...nameOrDefinition, commands } as any)
}
