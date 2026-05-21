import type {
  CliInstance,
  CliState,
  CommandDefinition,
  CreateOptions,
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

export const Cli = { create }

function register(cli: InternalCli, name: string, definition: CommandDefinition): CliInstance {
  const state = cli[stateSymbol]
  if (definition.fetch && !definition.run) {
    state.commands.set(name, {
      _fetch: true,
      basePath: definition.basePath,
      description: definition.description,
      fetch: definition.fetch,
      outputPolicy: definition.outputPolicy,
    } satisfies FetchEntry)
  } else state.commands.set(name, definition)

  for (const alias of definition.aliases ?? []) state.commands.set(alias, { _alias: true, target: name })
  return cli
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
