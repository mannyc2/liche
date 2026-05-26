import { defineExtension } from '@liche/core'
import type { CliExtension, SkillDefinition } from '@liche/core'
import { mcpInstaller } from '@liche/mcp-installer'
import { mcpServer } from '@liche/mcp-server'
import { skillsInstaller } from '@liche/skills-installer'
import { skillsRuntime } from '@liche/skills-runtime'
import { tokens } from '@liche/tokens'

export type AgentsOptions = {
  command?: string | undefined
  skill?: SkillDefinition | undefined
}

const AGENT_HELPER_COMMANDS = ['mcp add', 'skills add', 'skills list']

export function agents(options: AgentsOptions = {}): CliExtension {
  const installer = mcpInstaller({ command: options.command })
  const server = mcpServer({ tools: { exclude: AGENT_HELPER_COMMANDS } })
  const skills = skillsInstaller({ skill: options.skill })
  const runtime = skillsRuntime({ commands: { exclude: AGENT_HELPER_COMMANDS } })
  const tk = tokens()
  return defineExtension({
    id: 'liche.agents',
    commands: [
      ...(installer.commands ?? []),
      ...(skills.commands ?? []),
    ],
    fetchRoutes: [...(server.fetchRoutes ?? [])],
    globals: [...(server.globals ?? []), ...(runtime.globals ?? []), ...(tk.globals ?? [])],
    outputTransforms: [...(tk.outputTransforms ?? [])],
    serveHandlers: [...(server.serveHandlers ?? []), ...(runtime.serveHandlers ?? [])],
    ...(options.skill ? { skill: options.skill } : undefined),
  })
}

export { skillsRuntime as llms } from '@liche/skills-runtime'
