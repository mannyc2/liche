import type {
  CliInstance,
  CliState,
  CommandDefinition,
  CreateOptions,
  DeclarativeCommand,
  DefineCliOptions,
  FetchEntry,
  GroupEntry,
  Schema,
  ServeOptions,
  MiddlewareHandler,
  CliEventSubscriber,
  CliEventTarget,
  CliHookHandler,
  CliHookType,
} from '../types.js'
import { fetchCli } from './fetch.js'
import { normalizeEvents, normalizeHooks } from './lifecycle.js'
import { serveCli } from './serve.js'

export const stateSymbol: unique symbol = Symbol('lili.cli.state')
export type InternalCli = CliInstance & { [stateSymbol]: CliState }

export function create<
  A extends Schema<any> | undefined = undefined,
  E extends Schema<any> | undefined = undefined,
  O extends Schema<any> | undefined = undefined,
  Out extends Schema<any> | undefined = undefined,
>(name: string, definition?: CreateOptions<A, E, O, Out>): CliInstance
export function create<
  A extends Schema<any> | undefined = undefined,
  E extends Schema<any> | undefined = undefined,
  O extends Schema<any> | undefined = undefined,
  Out extends Schema<any> | undefined = undefined,
>(definition: CreateOptions<A, E, O, Out> & { name: string }): CliInstance
export function create(nameOrDefinition: string | (CreateOptions & { name: string }), maybeDefinition: CreateOptions = {}): CliInstance {
  const name = typeof nameOrDefinition === 'string' ? nameOrDefinition : nameOrDefinition.name
  const definition = typeof nameOrDefinition === 'string' ? maybeDefinition : nameOrDefinition
  const root = definition.run || definition.fetch ? definition : undefined
  const state: CliState = {
    commands: new Map(),
    def: definition,
    events: normalizeEvents(definition.events),
    hooks: normalizeHooks(definition.hooks),
    middlewares: [],
    root,
  }

  const cli: InternalCli = {
    [stateSymbol]: state,
    name,
    description: definition.description,
    env: definition.env,
    vars: definition.vars,

    command(nameOrCli: string | CliInstance, commandDefinition?: CommandDefinition) {
      if (typeof nameOrCli !== 'string') return mount(cli, nameOrCli as InternalCli)
      return register(cli, nameOrCli, commandDefinition ?? {})
    },

    fetch(request: Request) {
      return fetchCli(name, state, request)
    },

    hook<T extends CliHookType>(type: T, handler: CliHookHandler<T>) {
      state.hooks[type].push(handler as any)
      return cli
    },

    on(target: CliEventTarget, subscriber: CliEventSubscriber) {
      state.events.push({ subscriber, target })
      return cli
    },

    serve(argv?: string[], options: ServeOptions = {}) {
      return serveCli(name, state, argv ?? Bun.argv.slice(2), options)
    },

    use(handler: MiddlewareHandler) {
      state.middlewares.push(handler)
      return cli
    },
  }

  return cli
}

export function defineCommand<
  A extends Schema<any> | undefined = undefined,
  E extends Schema<any> | undefined = undefined,
  O extends Schema<any> | undefined = undefined,
  Out extends Schema<any> | undefined = undefined,
>(definition: DeclarativeCommand<A, E, O, Out>): DeclarativeCommand<A, E, O, Out> {
  return Object.freeze({
    ...definition,
    ...(definition.aliases ? { aliases: Object.freeze(definition.aliases.map((alias) => Object.freeze([...alias]))) } : undefined),
    path: Object.freeze([...definition.path]) as readonly [string, ...string[]],
  })
}

export function defineCli(definition: DefineCliOptions): CliInstance {
  const { commands = [], ...rootDefinition } = definition
  const cli = create(rootDefinition as CreateOptions & { name: string }) as InternalCli
  for (const command of commands) registerDeclarative(cli, command)
  return cli
}

export const Cli = { create }

function register(cli: InternalCli, name: string, definition: CommandDefinition): CliInstance {
  const state = cli[stateSymbol]
  setCommandEntry(state.commands, name, definition)
  for (const alias of definition.aliases ?? []) state.commands.set(alias, { _alias: true, target: name })
  return cli
}

function setCommandEntry(commands: Map<string, any>, name: string, definition: CommandDefinition): void {
  if (definition.fetch && !definition.run) {
    commands.set(name, {
      _fetch: true,
      basePath: definition.basePath,
      description: definition.description,
      fetch: definition.fetch,
      outputPolicy: definition.outputPolicy,
    } satisfies FetchEntry)
  } else commands.set(name, definition)
}

function mount(parent: InternalCli, child: InternalCli): CliInstance {
  const childState = child[stateSymbol]
  const group: GroupEntry = {
    _group: true,
    commands: childState.commands,
    description: child.description,
    events: childState.events,
    hooks: childState.hooks,
    middlewares: childState.middlewares,
    name: child.name,
    outputPolicy: childState.def.outputPolicy,
    root: childState.root,
  }

  parent[stateSymbol].commands.set(child.name, childState.root && childState.commands.size === 0 ? childState.root : group)
  return parent
}

function registerDeclarative(cli: InternalCli, command: DeclarativeCommand): void {
  const path = [...command.path]
  const leaf = path.at(-1)
  if (!leaf) throw new Error('Declarative command path must contain at least one segment')

  const parentCommands = ensureCommandParent(cli[stateSymbol].commands, path.slice(0, -1))
  const definition = normalizeDeclarativeCommand(command)
  const existing = parentCommands.get(leaf)
  if (existing?._group) {
    if (definition.description !== undefined) existing.description = definition.description
    if (definition.outputPolicy !== undefined) existing.outputPolicy = definition.outputPolicy
    if (definition.run) existing.root = definition
  } else {
    setCommandEntry(parentCommands, leaf, definition)
  }

  for (const alias of command.aliases ?? []) registerDeclarativeAlias(cli[stateSymbol].commands, path, [...alias])
}

function normalizeDeclarativeCommand(command: DeclarativeCommand): CommandDefinition {
  const {
    aliases: _aliases,
    input,
    path: _path,
    run,
    summary,
    ...definition
  } = command

  return {
    ...definition,
    ...(input?.aliases ? { alias: input.aliases } : undefined),
    ...(definition.description ?? summary ? { description: definition.description ?? summary } : undefined),
    ...(input?.args ? { args: input.args } : undefined),
    ...(input?.config ? { optionConfig: input.config } : undefined),
    ...(input?.env ? { env: input.env } : undefined),
    ...(input?.options ? { options: input.options } : undefined),
    ...(definition.effects ? undefined : command.safety ? { effects: effectsFromSafety(command.safety) } : undefined),
    ...(definition.policy ? undefined : command.safety ? { policy: policyFromSafety(command.safety) } : undefined),
    ...(summary ? { summary } : undefined),
    ...(run
      ? {
          run: (ctx) =>
            run({
              ctx,
              input: {
                args: ctx.args,
                config: ctx.config,
                env: ctx.env,
                options: ctx.options,
              },
            }),
        }
      : undefined),
  } as CommandDefinition
}

function ensureCommandParent(commands: Map<string, any>, path: string[]): Map<string, any> {
  let current = commands
  for (const segment of path) {
    const existing = current.get(segment)
    if (existing?._group) {
      current = existing.commands
      continue
    }
    if (existing) {
      const group = groupFromExisting(segment, existing)
      current.set(segment, group)
      current = group.commands
      continue
    }

    const group: GroupEntry = {
      _group: true,
      commands: new Map(),
      events: [],
      hooks: { beforeExecute: [] },
      middlewares: [],
      name: segment,
    }
    current.set(segment, group)
    current = group.commands
  }
  return current
}

function groupFromExisting(segment: string, existing: any): GroupEntry {
  if (existing?._alias) throw new Error(`Cannot create command group '${segment}' over an existing alias`)
  if (existing?._fetch) throw new Error(`Cannot create command group '${segment}' over an existing fetch command`)

  return {
    _group: true,
    commands: new Map(),
    description: existing.description,
    events: [],
    hooks: { beforeExecute: [] },
    middlewares: [],
    name: segment,
    outputPolicy: existing.outputPolicy,
    ...(existing.run ? { root: existing } : undefined),
  }
}

function registerDeclarativeAlias(commands: Map<string, any>, targetPath: string[], aliasPath: string[]): void {
  if (!aliasPath.length) throw new Error('Declarative command aliases must contain at least one segment')

  const targetParent = targetPath.slice(0, -1)
  const aliasParent = aliasPath.length === 1 ? targetParent : aliasPath.slice(0, -1)
  if (aliasParent.join('\0') !== targetParent.join('\0')) {
    throw new Error('Declarative command aliases must share the target command parent path')
  }

  const parent = ensureCommandParent(commands, targetParent)
  parent.set(aliasPath.at(-1)!, { _alias: true, target: targetPath.at(-1)! })
}

function effectsFromSafety(safety: NonNullable<DeclarativeCommand['safety']>) {
  return {
    kind: safety.readOnly === true ? 'read' : safety.destructive === true ? 'delete' : 'write',
    ...(safety.idempotent !== undefined ? { idempotent: safety.idempotent } : undefined),
  } as const
}

function policyFromSafety(safety: NonNullable<DeclarativeCommand['safety']>) {
  return {
    ...(safety.destructive !== undefined ? { dangerous: safety.destructive } : undefined),
    ...(safety.destructive === true ? { requiresConfirmation: true } : undefined),
  }
}
