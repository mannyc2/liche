import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY = 'https://registry.npmjs.org'
const DEFAULT_BOOTSTRAP_VERSION = '0.0.0-bootstrap.0'
const DEFAULT_BOOTSTRAP_TAG = 'bootstrap'

const PUBLIC_PACKAGES = [
  { name: '@liche/core', dir: 'packages/core' },
  { name: '@liche/auth', dir: 'packages/extensions/auth' },
  { name: '@liche/completions', dir: 'packages/extensions/completions' },
  { name: '@liche/config', dir: 'packages/extensions/config' },
  { name: '@liche/mcp-installer', dir: 'packages/extensions/agents/mcp-installer' },
  { name: '@liche/mcp-server', dir: 'packages/extensions/agents/mcp-server' },
  { name: '@liche/skills-installer', dir: 'packages/extensions/agents/skills-installer' },
  { name: '@liche/skills-runtime', dir: 'packages/extensions/agents/skills-runtime' },
  { name: '@liche/telemetry', dir: 'packages/extensions/telemetry' },
  { name: '@liche/tokens', dir: 'packages/extensions/agents/tokens' },
  { name: '@liche/agents', dir: 'packages/extensions/agents/bundle' },
  { name: '@liche/extensions', dir: 'packages/extensions' },
  { name: '@liche/build', dir: 'packages/build' },
  { name: '@liche/releases', dir: 'packages/releases' },
  { name: '@liche/product', dir: 'packages/product' },
] as const

type PublicPackage = (typeof PUBLIC_PACKAGES)[number]

type RegistryStatus = {
  name: string
  status: 'published' | 'missing'
  latest: string | null
}

function hasArg(name: string): boolean {
  return process.argv.includes(name)
}

function stringArg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function run(cmd: string, args: string[], cwd: string): void {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path: string, value: Record<string, any>): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function registryStatus(pkg: PublicPackage): Promise<RegistryStatus> {
  const response = await fetch(`${REGISTRY}/${encodeURIComponent(pkg.name)}`, {
    headers: { accept: 'application/json' },
  })
  if (response.status === 404) return { name: pkg.name, status: 'missing', latest: null }
  if (!response.ok) throw new Error(`${pkg.name}: npm registry returned ${response.status} ${response.statusText}`)
  const body = (await response.json()) as { 'dist-tags'?: { latest?: string } }
  return { name: pkg.name, status: 'published', latest: body['dist-tags']?.latest ?? null }
}

function rewriteInternalDependencies(
  json: Record<string, any>,
  statusesByName: Map<string, RegistryStatus>,
  bootstrapVersion: string,
): void {
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const dependencies = json[section]
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue

    for (const name of Object.keys(dependencies)) {
      if (!name.startsWith('@liche/')) continue
      const status = statusesByName.get(name)
      if (!status) continue
      dependencies[name] = status.status === 'published' && status.latest ? `^${status.latest}` : bootstrapVersion
    }
  }
}

function stageBootstrapPackage(
  pkg: PublicPackage,
  statusesByName: Map<string, RegistryStatus>,
  bootstrapVersion: string,
): string {
  const sourceDir = join(REPO_ROOT, pkg.dir)
  const tempRoot = mkdtempSync(join(tmpdir(), 'liche-npm-bootstrap-'))
  const stagedDir = join(tempRoot, basename(pkg.dir))

  cpSync(sourceDir, stagedDir, {
    recursive: true,
    filter(source) {
      const name = basename(source)
      return name !== 'node_modules' && name !== '.git'
    },
  })

  const packageJsonPath = join(stagedDir, 'package.json')
  if (!existsSync(packageJsonPath)) throw new Error(`${pkg.dir} is missing package.json`)

  const json = readJson(packageJsonPath)
  json.version = bootstrapVersion
  rewriteInternalDependencies(json, statusesByName, bootstrapVersion)
  writeJson(packageJsonPath, json)
  return stagedDir
}

async function main(): Promise<void> {
  const dryRun = hasArg('--dry-run')
  const bootstrapVersion = stringArg('--version', DEFAULT_BOOTSTRAP_VERSION)
  const bootstrapTag = stringArg('--tag', DEFAULT_BOOTSTRAP_TAG)
  const statuses = await Promise.all(PUBLIC_PACKAGES.map((pkg) => registryStatus(pkg)))
  const statusesByName = new Map(statuses.map((status) => [status.name, status]))
  const missingPackages = PUBLIC_PACKAGES.filter((pkg) => statusesByName.get(pkg.name)?.status === 'missing')

  if (missingPackages.length === 0) {
    console.log('All public package names already exist on npm.')
    return
  }

  console.log(
    `Bootstrapping ${missingPackages.length} npm package name(s) at ${bootstrapVersion} with tag ${bootstrapTag}:`,
  )
  for (const pkg of missingPackages) console.log(`- ${pkg.name} (${pkg.dir})`)

  if (dryRun) {
    console.log('\nDry run only. No packages were published.')
    return
  }

  for (const pkg of missingPackages) {
    const stagedDir = stageBootstrapPackage(pkg, statusesByName, bootstrapVersion)
    try {
      console.log(`\nPublishing bootstrap package ${pkg.name} from ${stagedDir}`)
      run('npm', ['publish', '--access', 'public', '--tag', bootstrapTag], stagedDir)
    } finally {
      rmSync(dirname(stagedDir), { force: true, recursive: true })
    }
  }
}

await main()
