import { defineExtension } from '@liche/core'
import type { CliExtension, SkillDefinition } from '@liche/core'
import { mcpInstaller } from '@liche/mcp-installer'
import { mcpServer } from '@liche/mcp-server'
import { skillsInstaller } from '@liche/skills-installer'
import { skillsRuntime } from '@liche/skills-runtime'

export type AgentsOptions = {
  command?: string | undefined
  skill?: SkillDefinition | undefined
}

export function agents(options: AgentsOptions = {}): CliExtension {
  const installer = mcpInstaller({ command: options.command })
  const server = mcpServer()
  const skills = skillsInstaller({ skill: options.skill })
  const runtime = skillsRuntime()
  return defineExtension({
    id: 'liche.agents',
    commands: [
      ...(installer.commands ?? []),
      ...(skills.commands ?? []),
    ],
    fetchRoutes: [...(server.fetchRoutes ?? [])],
    globals: [...(server.globals ?? []), ...(runtime.globals ?? [])],
    serveHandlers: [...(server.serveHandlers ?? []), ...(runtime.serveHandlers ?? [])],
    ...(options.skill ? { skill: options.skill } : undefined),
  })
}

export { skillsRuntime as llms } from '@liche/skills-runtime'
