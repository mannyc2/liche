import { defineExtension } from '@liche/core'
import type { CliExtension, SkillDefinition } from '@liche/core'
import { mcpInstaller } from '@liche/mcp'
import { skillsInstaller } from '@liche/skills'

export type AgentsOptions = {
  command?: string | undefined
  skill?: SkillDefinition | undefined
}

export function agents(options: AgentsOptions = {}): CliExtension {
  return defineExtension({
    id: 'liche.agents',
    commands: [
      ...(mcpInstaller({ command: options.command }).commands ?? []),
      ...(skillsInstaller({ skill: options.skill }).commands ?? []),
    ],
    ...(options.skill ? { skill: options.skill } : undefined),
  })
}
