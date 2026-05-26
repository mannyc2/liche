import { spawnSync } from 'node:child_process'

const REPOSITORY = 'mannyc2/liche'
const WORKFLOW_FILE = 'publish.yml'
const ENVIRONMENT = 'npm-production'

const PUBLIC_PACKAGES = [
  '@liche/core',
  '@liche/auth',
  '@liche/completions',
  '@liche/config',
  '@liche/mcp-installer',
  '@liche/mcp-server',
  '@liche/skills-installer',
  '@liche/skills-runtime',
  '@liche/telemetry',
  '@liche/tokens',
  '@liche/agents',
  '@liche/extensions',
  '@liche/build',
  '@liche/releases',
  '@liche/product',
] as const

function hasArg(name: string): boolean {
  return process.argv.includes(name)
}

function packageFilter(): Set<string> | null {
  const index = process.argv.indexOf('--packages')
  if (index === -1) return null
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error('--packages requires a comma-separated package list')
  return new Set(value.split(',').map((name) => name.trim()).filter(Boolean))
}

function runCapture(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('npm', args, { encoding: 'utf8', env: process.env })
  if (result.error) throw result.error
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function run(args: string[]): void {
  const result = spawnSync('npm', args, { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function hasTrustedPublisher(packageName: string): boolean {
  const result = runCapture(['trust', 'list', packageName, '--json'])
  if (!result.ok) return false
  try {
    const body = JSON.parse(result.stdout)
    return Array.isArray(body) ? body.length > 0 : Boolean(body && Object.keys(body).length > 0)
  } catch {
    return result.stdout.trim().length > 0
  }
}

async function main(): Promise<void> {
  const dryRun = hasArg('--dry-run')
  const selected = packageFilter()
  const packageNames = selected ? PUBLIC_PACKAGES.filter((name) => selected.has(name)) : [...PUBLIC_PACKAGES]

  if (selected && packageNames.length !== selected.size) {
    const unknown = [...selected].filter((name) => !PUBLIC_PACKAGES.includes(name as any))
    throw new Error(`Unknown package(s): ${unknown.join(', ')}`)
  }

  for (const packageName of packageNames) {
    const args = [
      'trust',
      'github',
      packageName,
      '--repo',
      REPOSITORY,
      '--file',
      WORKFLOW_FILE,
      '--env',
      ENVIRONMENT,
      '--allow-publish',
      '--yes',
    ]

    if (dryRun) {
      console.log(`npm ${args.join(' ')}`)
      continue
    }

    if (hasTrustedPublisher(packageName)) {
      console.log(`${packageName}: trusted publisher already configured; skipping`)
      continue
    }

    console.log(`${packageName}: configuring trusted publisher`)
    run(args)
    await sleep(2000)
  }
}

await main()
