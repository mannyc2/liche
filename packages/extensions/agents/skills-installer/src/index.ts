import { mkdir } from 'node:fs/promises'
import { defineCommand, defineExtension, z } from '@liche/core'
import type { CliExtension, SkillDefinition } from '@liche/core'

type Env = Record<string, string | undefined>

export type SkillsInstallerOptions = {
  skill?: SkillDefinition | undefined
}

export type WriteSkillOptions = {
  agent?: string | undefined
  cwd?: string | undefined
  env?: Env | undefined
  global?: boolean | undefined
  skill?: SkillDefinition | undefined
}

const installEnv = z.object({
  APPDATA: z.string().optional(),
  HOME: z.string().optional(),
  USERPROFILE: z.string().optional(),
  XDG_CONFIG_HOME: z.string().optional(),
}).passthrough()

const installOptions = z.object({
  agent: z.string().optional(),
  global: z.boolean().default(true),
})

export function skillsInstaller(options: SkillsInstallerOptions = {}): CliExtension {
  const skill = options.skill
  return defineExtension({
    id: 'liche.skills-installer',
    commands: [
      defineCommand({
        description: 'Sync skill file',
        input: { env: installEnv, options: installOptions },
        path: ['skills', 'add'],
        run: async ({ ctx, input }) => ({
          path: await writeSkill(ctx.name, {
            agent: input.options.agent,
            env: ctx.env as Env,
            global: input.options.global !== false,
            skill,
          }),
        }),
        safety: { idempotent: true },
      }),
      defineCommand({
        description: 'List available skills',
        path: ['skills', 'list'],
        run: ({ ctx }) => ({ skills: [{ installed: false, name: ctx.name }] }),
        safety: { readOnly: true },
      }),
    ],
    ...(skill ? { skill } : undefined),
  })
}

export async function writeSkill(name: string, options: WriteSkillOptions = {}): Promise<string> {
  const env = options.env ?? (process.env as Env)
  const cwd = options.cwd ?? process.cwd()
  const isGlobal = options.global !== false
  const dir = skillDirFor(name, options.agent ?? 'claude-code', isGlobal, env, cwd)
  await mkdir(dir, { recursive: true })
  const path = `${dir}/SKILL.md`
  await Bun.write(path, options.skill?.markdown ?? defaultSkillMarkdown(name))
  return path
}

function skillDirFor(name: string, agent: string, isGlobal: boolean, env: Env, cwd: string): string {
  if (agent === 'claude-code') {
    return isGlobal ? `${home(env)}/.claude/skills/${name}` : `${cwd}/.claude/skills/${name}`
  }
  if (agent === 'cursor') {
    return isGlobal ? `${home(env)}/.cursor/skills/${name}` : `${cwd}/.cursor/skills/${name}`
  }
  return `${home(env)}/.config/liche/skills/${name}`
}

function home(env: Env): string {
  return env['HOME'] ?? env['USERPROFILE'] ?? '.'
}

function defaultSkillMarkdown(name: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: ${name} CLI`,
    '---',
    '',
    `# ${name}`,
    '',
    `Use the ${name} CLI through its documented commands.`,
  ].join('\n')
}
