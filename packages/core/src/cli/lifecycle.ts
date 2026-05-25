import type {
  BeforeExecuteHook,
  CliEvent,
  CliEventCommand,
  CliEventRegistration,
  CliEventSubscription,
  CliHooks,
  CliHookRegistration,
  PrepareContextHook,
  SelectedCommand,
} from '../types.js'

export function normalizeEvents(events: readonly CliEventRegistration[] | undefined): CliEventSubscription[] {
  return (events ?? []).map((event) => typeof event === 'function' ? { subscriber: event, target: '*' } : event)
}

export function normalizeHooks(hooks: CliHookRegistration | undefined): CliHooks {
  return {
    beforeExecute: normalizeHookList(hooks?.beforeExecute),
    prepareContext: normalizePrepareList(hooks?.prepareContext),
  }
}

export function mergeHooks(...hooks: readonly CliHooks[]): CliHooks {
  return {
    beforeExecute: hooks.flatMap((entry) => entry.beforeExecute),
    prepareContext: hooks.flatMap((entry) => entry.prepareContext),
  }
}

export async function emitLifecycleEvent(subscriptions: readonly CliEventSubscription[], event: CliEvent): Promise<void> {
  const matching = subscriptions.filter((entry) => entry.target === '*' || entry.target === event.type)
  await Promise.all(matching.map(async (entry) => {
    try {
      await entry.subscriber(snapshotEvent(event))
    } catch {
      // Lifecycle subscribers are observe-only. They must never alter command execution.
    }
  }))
}

export function createLifecycleEvent(
  binaryName: string,
  version: string | undefined,
  event: Omit<CliEvent, 'cli' | 'occurredAt'>,
): CliEvent {
  return {
    cli: { name: binaryName, ...(version !== undefined ? { version } : undefined) },
    occurredAt: new Date().toISOString(),
    ...event,
  }
}

export function eventCommand(selected: SelectedCommand): CliEventCommand {
  return {
    id: selected.path.length ? selected.path.join(' ') : '(root)',
    path: selected.path,
  }
}

function normalizeHookList(hook: BeforeExecuteHook | readonly BeforeExecuteHook[] | undefined): BeforeExecuteHook[] {
  if (hook === undefined) return []
  return typeof hook === 'function' ? [hook] : [...hook]
}

function normalizePrepareList(hook: PrepareContextHook | readonly PrepareContextHook[] | undefined): PrepareContextHook[] {
  if (hook === undefined) return []
  return typeof hook === 'function' ? [hook] : [...hook]
}

function snapshotEvent(event: CliEvent): Readonly<CliEvent> {
  const snapshot = {
    ...event,
    cli: Object.freeze({ ...event.cli }),
    ...(event.command ? { command: Object.freeze({ ...event.command, path: Object.freeze([...event.command.path]) }) } : undefined),
    ...(event.completion ? { completion: Object.freeze({ ...event.completion }) } : undefined),
    ...(event.error ? { error: Object.freeze({ ...event.error }) } : undefined),
    ...(event.mcp ? { mcp: Object.freeze({ ...event.mcp }) } : undefined),
    ...(event.surface ? { surface: Object.freeze({ ...event.surface }) } : undefined),
  }
  return Object.freeze(snapshot)
}
