import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const PUBLIC_PACKAGES = [
  { name: '@liche/core', dir: 'packages/core' },
  { name: '@liche/extensions', dir: 'packages/extensions' },
  { name: '@liche/build', dir: 'packages/build' },
  { name: '@liche/product', dir: 'packages/product' },
  { name: '@liche/releases', dir: 'packages/releases' },
] as const

const REQUIRED_SUPPORT_FILES = [
  'LICENSE',
  'SECURITY.md',
  'SUPPORT.md',
  'CHANGELOG.md',
  'docs/release-and-distribution.md',
  '.github/workflows/publish.yml',
] as const

const FORBIDDEN_PLACEHOLDER = /\b(TODO|TBD|changeme|example\.com|example\.test|acme)\b/i

type CheckStatus = 'pass' | 'fail'

type CheckResult = {
  id: string
  status: CheckStatus
  message: string
}

type MetadataCheckReport = {
  schemaVersion: 1
  ok: boolean
  checks: CheckResult[]
  packages: Array<{
    name: string
    dir: string
    license: string
    files: string[]
    repository: string | null
    homepage: string | null
    bugs: string | null
    funding: string | null
  }>
  remainingHumanGates: string[]
}

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function pass(id: string, message: string): CheckResult {
  return { id, status: 'pass', message }
}

function fail(id: string, message: string): CheckResult {
  return { id, status: 'fail', message }
}

function textHasPlaceholder(path: string): boolean {
  return FORBIDDEN_PLACEHOLDER.test(readFileSync(path, 'utf8'))
}

function packageMetadataValue(json: Record<string, any>, key: string): string | null {
  const value = json[key]
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return JSON.stringify(value)
  return null
}

function collectBinIssues(packageDir: string, bin: unknown): string[] {
  if (bin === undefined) return []
  if (!bin || typeof bin !== 'object' || Array.isArray(bin)) return ['bin must be an object when present']

  const issues: string[] = []
  for (const [name, target] of Object.entries(bin)) {
    if (typeof target !== 'string') {
      issues.push(`${name} target must be a string`)
      continue
    }
    if (target.startsWith('./')) {
      issues.push(`${name} target must omit leading ./ so npm publish does not normalize the package`)
    }
    if (!target.startsWith('src/') || !target.endsWith('.ts')) {
      issues.push(`${name} target must point at src/*.ts`)
    }
    if (!existsSync(join(packageDir, target))) {
      issues.push(`${name} target ${target} does not exist`)
    }
  }
  return issues
}

function expectedPackageFiles(packageName: string): string[] {
  return packageName === '@liche/core'
    ? ['src', 'README.md', 'SKILL.md', 'LICENSE']
    : ['src', 'README.md', 'LICENSE']
}

export function collectReleaseMetadataCheck(): MetadataCheckReport {
  const checks: CheckResult[] = []

  for (const file of REQUIRED_SUPPORT_FILES) {
    const path = join(REPO_ROOT, file)
    checks.push(
      existsSync(path)
        ? pass(`support-file:${file}`, `${file} exists`)
        : fail(`support-file:${file}`, `${file} is missing`),
    )
  }

  const rootJson = readJson(join(REPO_ROOT, 'package.json'))
  checks.push(
    rootJson.private === true
      ? pass('root-private', 'root workspace is private')
      : fail('root-private', 'root workspace must stay private'),
  )
  checks.push(
    rootJson.license === 'MIT'
      ? pass('root-license', 'root package declares MIT')
      : fail('root-license', 'root package must declare MIT'),
  )
  checks.push(
    rootJson.scripts?.['release:metadata'] === 'bun scripts/release-metadata-check.ts'
      ? pass('script:release-metadata', 'release:metadata runs the offline metadata check')
      : fail('script:release-metadata', 'release:metadata must run scripts/release-metadata-check.ts'),
  )
  checks.push(
    rootJson.scripts?.['release:names'] === 'bun scripts/check-npm-package-availability.ts'
      ? pass('script:release-names', 'release:names runs the live npm package-name probe')
      : fail('script:release-names', 'release:names must run scripts/check-npm-package-availability.ts'),
  )
  checks.push(
    String(rootJson.scripts?.['release:check'] ?? '').includes('bun run --silent release:metadata')
      ? pass('script:release-check-metadata', 'release:check includes the offline metadata gate')
      : fail('script:release-check-metadata', 'release:check must include release:metadata'),
  )

  const publishWorkflowPath = join(REPO_ROOT, '.github/workflows/publish.yml')
  if (existsSync(publishWorkflowPath)) {
    const workflow = readFileSync(publishWorkflowPath, 'utf8')
    checks.push(
      workflow.includes('id-token: write')
        ? pass('workflow:oidc-permission', 'publish workflow grants id-token: write')
        : fail('workflow:oidc-permission', 'publish workflow must grant id-token: write'),
    )
    checks.push(
      workflow.includes('environment: npm-production')
        ? pass('workflow:npm-environment', 'publish workflow uses npm-production environment')
        : fail('workflow:npm-environment', 'publish workflow must use npm-production environment'),
    )
    checks.push(
      workflow.includes('node-version: "24"') || workflow.includes("node-version: '24'")
        ? pass('workflow:node-version', 'publish workflow uses Node 24')
        : fail('workflow:node-version', 'publish workflow must use Node 24 for npm trusted publishing'),
    )
    checks.push(
      workflow.includes('npm install -g npm@^11.10.0')
        ? pass('workflow:npm-version', 'publish workflow installs npm 11.10+')
        : fail('workflow:npm-version', 'publish workflow must install npm 11.10+'),
    )
    checks.push(
      workflow.includes('package-manager-cache: false')
        ? pass('workflow:no-release-cache', 'publish workflow disables package-manager cache')
        : fail('workflow:no-release-cache', 'publish workflow must disable package-manager cache'),
    )
  }

  const packages = PUBLIC_PACKAGES.map((pkg) => {
    const packageDir = join(REPO_ROOT, pkg.dir)
    const json = readJson(join(packageDir, 'package.json'))
    const files = Array.isArray(json.files) ? json.files.map(String) : []
    const packageLicensePath = join(packageDir, 'LICENSE')

    checks.push(
      json.license === 'MIT'
        ? pass(`package-license:${pkg.name}`, `${pkg.name} declares MIT`)
        : fail(`package-license:${pkg.name}`, `${pkg.name} must declare MIT`),
    )
    checks.push(
      existsSync(packageLicensePath)
        ? pass(`package-license-file:${pkg.name}`, `${pkg.name} ships LICENSE`)
        : fail(`package-license-file:${pkg.name}`, `${pkg.name} is missing LICENSE`),
    )
    const expectedFiles = expectedPackageFiles(pkg.name)
    checks.push(
      JSON.stringify(files) === JSON.stringify(expectedFiles)
        ? pass(`package-files:${pkg.name}`, `${pkg.name} has narrow publish files`)
        : fail(`package-files:${pkg.name}`, `${pkg.name} files must be ${JSON.stringify(expectedFiles)}`),
    )
    checks.push(
      json.publishConfig?.access === 'public'
        ? pass(`package-access:${pkg.name}`, `${pkg.name} publishes publicly`)
        : fail(`package-access:${pkg.name}`, `${pkg.name} publishConfig.access must be public`),
    )

    const binIssues = collectBinIssues(packageDir, json.bin)
    checks.push(
      binIssues.length === 0
        ? pass(`package-bin:${pkg.name}`, `${pkg.name} has npm-stable bin metadata`)
        : fail(`package-bin:${pkg.name}`, binIssues.join('; ')),
    )

    const metadataText = JSON.stringify({
      repository: json.repository,
      homepage: json.homepage,
      bugs: json.bugs,
      funding: json.funding,
    })
    checks.push(
      FORBIDDEN_PLACEHOLDER.test(metadataText)
        ? fail(`package-placeholder:${pkg.name}`, `${pkg.name} has placeholder public metadata`)
        : pass(`package-placeholder:${pkg.name}`, `${pkg.name} has no placeholder public metadata`),
    )

    return {
      name: pkg.name,
      dir: pkg.dir,
      license: String(json.license ?? ''),
      files,
      repository: packageMetadataValue(json, 'repository'),
      homepage: packageMetadataValue(json, 'homepage'),
      bugs: packageMetadataValue(json, 'bugs'),
      funding: packageMetadataValue(json, 'funding'),
    }
  })

  for (const file of ['SECURITY.md', 'SUPPORT.md', 'CHANGELOG.md', 'docs/release-and-distribution.md']) {
    const path = join(REPO_ROOT, file)
    if (existsSync(path)) {
      checks.push(
        textHasPlaceholder(path)
          ? fail(`placeholder:${file}`, `${file} contains placeholder language`)
          : pass(`placeholder:${file}`, `${file} contains no banned placeholders`),
      )
    }
  }

  return {
    schemaVersion: 1,
    ok: checks.every((check) => check.status === 'pass'),
    checks,
    packages,
    remainingHumanGates: [
      'Confirm npm organization ownership and package publish rights for the final scope before each manual publish.',
      'Set package repository/homepage/bugs/funding only after canonical public URLs are real.',
      'Configure or verify npm trusted publishers for .github/workflows/publish.yml and npm-production before relying on CI publishing.',
      'Configure PyPI trusted publishers for the final release workflow and environment when PyPI artifacts are published.',
      'Verify GitHub release asset layout and checksums against final release artifacts.',
    ],
  }
}

if (import.meta.main) {
  const report = collectReleaseMetadataCheck()
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}
