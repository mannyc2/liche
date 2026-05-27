import type {
  CliInstance,
  CliState,
  CliExtension,
  CommandEntry,
  CommandDefinition,
  CommandRuntime,
  CreateOptions,
  DeclarativeCommand,
  DefineCliOptions,
  FetchEntry,
  GroupEntry,
  Schema,
  RuntimeEntry,
  BeforeExecuteHook,
  CliHookRegistration,
  PrepareContextHook,
} from '../types.js'
import { commandContractFromDefinition, groupContract } from '../command/contract.js'
import { isCommand, isFetch } from '../command/guards.js'
import { globalRegistryFor } from '../globals/registry.js'
import { createOutputRendererRegistry } from '../format/index.js'
import { fetchCli } from './fetch.js'
import { normalizeEvents, normalizeHooks } from './lifecycle.js'

export const stateSymbol: unique symbol = Symbol('liche.cli.state')
export type InternalCli = CliInstance & { [stateSymbol]: CliState }

export function getCliState(cli: CliInstance): CliState {
  return (cli as InternalCli)[stateSymbol]
}

function create(definition: CreateOptions & { name: string }): CliInstance {
  const name = definition.name
  const root = definition.run || definition.fetch ? createRuntimeEntry('(root)', definition) : undefined
  const state: CliState = {
    commands: new Map(),
    def: definition,
    events: normalizeEvents(definition.events),
    fetchRoutes: definition.fetchRoutes ? [...definition.fetchRoutes] : [],
    globals: globalRegistryFor(definition),
    helpRenderer: definition.helpRenderer,
    hooks: normalizeHooks(definition.hooks),
    inputSources: definition.inputSources ? [...definition.inputSources] : [],
    middlewares: definition.middleware ? [...definition.middleware] : [],
    outputRenderers: createOutputRendererRegistry(definition.outputRenderers),
    outputTransforms: definition.outputTransforms ? [...definition.outputTransforms] : [],
    root,
    terminalHandlers: definition.terminalHandlers ? [...definition.terminalHandlers] : [],
  }

  const cli: InternalCli = {
    [stateSymbol]: state,
    name,
    description: definition.description,
    env: definition.env,
    vars: definition.vars,

    fetch(request: Request) {
      return fetchCli(name, state, request)
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
    ...(definition.aliases
      ? { aliases: Object.freeze(definition.aliases.map((alias) => Object.freeze(typeof alias === 'string' ? [alias] : [...alias]))) }
      : undefined),
    path: Object.freeze([...definition.path]) as readonly [string, ...string[]],
  })
}

export function defineExtension(extension: CliExtension): CliExtension {
  return Object.freeze({ ...extension })
}

export function defineCli(definition: DefineCliOptions): CliInstance {
  const expanded = applyExtensions(definition)
  const { commands = [], ...rootDefinition } = expanded
  const cli = create(rootDefinition as CreateOptions & { name: string }) as InternalCli
  for (const command of commands) registerDeclarative(cli, command)
  return cli
}

function applyExtensions(definition: DefineCliOptions): Omit<DefineCliOptions, 'extensions'> {
  assertRemovedRootFields(definition)
  const extensions = definition.extensions ?? []
  const commands = [
    ...(definition.commands ?? []),
    ...extensions.flatMap((extension) => [...(extension.commands ?? [])]),
  ]
  const events = [
    ...(definition.events ?? []),
    ...extensions.flatMap((extension) => [...(extension.events ?? [])]),
  ]
  const middleware = [
    ...(definition.middleware ?? []),
    ...extensions.flatMap((extension) => [...(extension.middleware ?? [])]),
  ]
  const globals = [
    ...(definition.globals ?? []),
    ...extensions.flatMap((extension) => [...(extension.globals ?? [])]),
  ]
  const inputSources = [
    ...(definition.inputSources ?? []),
    ...extensions.flatMap((extension) => [...(extension.inputSources ?? [])]),
  ]
  const outputRenderers = [
    ...(definition.outputRenderers ?? []),
    ...extensions.flatMap((extension) => [...(extension.outputRenderers ?? [])]),
  ]
  const outputTransforms = [
    ...(definition.outputTransforms ?? []),
    ...extensions.flatMap((extension) => [...(extension.outputTransforms ?? [])]),
  ]
  const terminalHandlers = [
    ...(definition.terminalHandlers ?? []),
    ...extensions.flatMap((extension) => [...(extension.terminalHandlers ?? [])]),
  ]
  const fetchRoutes = [
    ...(definition.fetchRoutes ?? []),
    ...extensions.flatMap((extension) => [...(extension.fetchRoutes ?? [])]),
  ]
  const hooks = mergeHookRegistrations(definition.hooks, ...extensions.map((extension) => extension.hooks))
  const helpRenderer = singleExtensionValue('helpRenderer', definition.helpRenderer, extensions)
  const skill = singleExtensionValue('skill', definition.skill, extensions)
  const { extensions: _extensions, ...rest } = definition

  return {
    ...rest,
    ...(commands.length ? { commands } : undefined),
    ...(events.length ? { events } : undefined),
    ...(fetchRoutes.length ? { fetchRoutes } : undefined),
    ...(globals.length ? { globals } : undefined),
    ...(helpRenderer !== undefined ? { helpRenderer } : undefined),
    ...(hooks !== undefined ? { hooks } : undefined),
    ...(inputSources.length ? { inputSources } : undefined),
    ...(middleware.length ? { middleware } : undefined),
    ...(outputRenderers.length ? { outputRenderers } : undefined),
    ...(outputTransforms.length ? { outputTransforms } : undefined),
    ...(terminalHandlers.length ? { terminalHandlers } : undefined),
    ...(skill !== undefined ? { skill } : undefined),
  }
}

export { defineGlobal } from '../globals/definition.js'

function assertRemovedRootFields(definition: DefineCliOptions): void {
  const input = definition as Record<string, unknown>
  if (input['builtins'] !== undefined) {
    throw new Error('defineCli({ builtins }) was removed; install helper commands through extensions')
  }
}

function singleExtensionValue(
  key: 'helpRenderer' | 'skill',
  rootValue: unknown,
  extensions: readonly CliExtension[],
): any {
  const providers = extensions.filter((extension) => (extension as Record<string, unknown>)[key] !== undefined)
  if (providers.length === 0) return rootValue
  if (rootValue !== undefined) {
    throw new Error(`Cannot declare ${key} on defineCli() and an extension`)
  }
  if (providers.length > 1) {
    throw new Error(`Multiple extensions declare ${key}: ${providers.map((extension) => extension.id).join(', ')}`)
  }
  return (providers[0] as Record<string, unknown>)[key]
}

function mergeHookRegistrations(
  ...registrations: Array<CliHookRegistration | undefined>
): CliHookRegistration | undefined {
  const beforeExecute = registrations.flatMap((registration) => hookList(registration?.beforeExecute))
  const prepareContext = registrations.flatMap((registration) => prepareList(registration?.prepareContext))
  if (!beforeExecute.length && !prepareContext.length) return undefined
  return {
    ...(beforeExecute.length ? { beforeExecute } : undefined),
    ...(prepareContext.length ? { prepareContext } : undefined),
  }
}

function hookList(hook: BeforeExecuteHook | readonly BeforeExecuteHook[] | undefined): BeforeExecuteHook[] {
  if (hook === undefined) return []
  return typeof hook === 'function' ? [hook] : [...hook]
}

function prepareList(hook: PrepareContextHook | readonly PrepareContextHook[] | undefined): PrepareContextHook[] {
  if (hook === undefined) return []
  return typeof hook === 'function' ? [hook] : [...hook]
}

function setCommandEntry(commands: Map<string, any>, name: string, definition: CommandDefinition): void {
  commands.set(name, createRuntimeEntry(name, definition))
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
    existing.contract = groupContract(leaf, {
      description: existing.description,
      outputPolicy: existing.outputPolicy,
    })
    if (definition.run || definition.fetch) existing.root = createRuntimeEntry(leaf, definition)
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
    ...(input?.env ? { env: input.env } : undefined),
    ...(input?.options ? { options: input.options } : undefined),
    ...(input?.sources ? { sources: input.sources } : undefined),
    ...(summary ? { summary } : undefined),
    ...(run
      ? {
          run: (ctx) =>
            run({
              ctx,
              input: {
                args: ctx.args,
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
      contract: groupContract(segment, {}),
      events: [],
      hooks: { beforeExecute: [], prepareContext: [] },
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
  if (isFetch(existing)) throw new Error(`Cannot create command group '${segment}' over an existing fetch command`)
  if (!isCommand(existing)) throw new Error(`Cannot create command group '${segment}' over an unknown entry`)

  return {
    _group: true,
    commands: new Map(),
    contract: groupContract(segment, {
      description: existing.contract.description,
      outputPolicy: existing.contract.outputPolicy,
    }),
    description: existing.contract.description,
    events: [],
    hooks: { beforeExecute: [], prepareContext: [] },
    middlewares: [],
    name: segment,
    outputPolicy: existing.contract.outputPolicy,
    ...(existing.runtime.run ? { root: existing } : undefined),
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

function createRuntimeEntry(name: string, definition: CommandDefinition): RuntimeEntry {
  if (definition.fetch && !definition.run) {
    return {
      _fetch: true,
      basePath: definition.basePath,
      contract: commandContractFromDefinition(name, definition),
      fetch: definition.fetch,
    } satisfies FetchEntry
  }

  return {
    _command: true,
    contract: commandContractFromDefinition(name, definition),
    runtime: commandRuntime(definition),
  } satisfies CommandEntry
}

function commandRuntime(definition: CommandDefinition): CommandRuntime {
  return {
    ...(definition.alias ? { alias: definition.alias } : undefined),
    ...(definition.args ? { args: definition.args } : undefined),
    ...(definition.env ? { env: definition.env } : undefined),
    ...(definition.formats ? { formats: definition.formats } : undefined),
    ...(definition.middleware ? { middleware: definition.middleware } : undefined),
    ...(definition.options ? { options: definition.options } : undefined),
    ...(definition.output ? { output: definition.output } : undefined),
    ...(definition.run ? { run: definition.run } : undefined),
    ...(definition.sources ? { sources: definition.sources } : undefined),
  }
}
