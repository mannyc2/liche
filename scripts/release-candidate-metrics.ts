import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])

type PackageMetrics = {
  name: string
  dir: string
  source: {
    files: number
    loc: number
  }
  test: {
    files: number
    loc: number
  }
  public: {
    rootValueExports: number
    rootValueExportNames: string[]
    subpathExports: number
    subpathExportNames: string[]
  }
  runtimeDependencies: {
    count: number
    names: string[]
  }
  boundaryExceptions: string[]
}

type ReleaseCandidateMetrics = {
  schemaVersion: 1
  packages: PackageMetrics[]
  totals: {
    sourceFiles: number
    sourceLoc: number
    testFiles: number
    testLoc: number
    publicRootValueExports: number
    publicSubpathExports: number
    runtimeDependencies: number
    boundaryExceptions: number
  }
}

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function codeFiles(root: string): string[] {
  const files: string[] = []

  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name === '.git') continue
      const fullPath = join(dir, name)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        walk(fullPath)
        continue
      }
      const dot = name.lastIndexOf('.')
      const extension = dot === -1 ? '' : name.slice(dot)
      if (CODE_EXTENSIONS.has(extension)) files.push(fullPath)
    }
  }

  try {
    walk(root)
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error
  }

  return files.sort()
}

function loc(files: string[]): number {
  return files.reduce((total, file) => {
    const text = readFileSync(file, 'utf8')
    return total + text.split(/\r?\n/).filter((line) => line.trim().length > 0).length
  }, 0)
}

function exportMapSubpaths(exports: unknown): string[] {
  if (!exports || typeof exports !== 'object' || Array.isArray(exports)) return []
  return Object.keys(exports as Record<string, unknown>)
    .filter((key) => key !== '.')
    .sort()
}

async function packageMetrics(pkg: (typeof PUBLIC_PACKAGES)[number]): Promise<PackageMetrics> {
  const packageDir = join(REPO_ROOT, pkg.dir)
  const json = readJson(join(packageDir, 'package.json'))
  const sourceFiles = codeFiles(join(packageDir, 'src'))
  const testFiles = codeFiles(join(packageDir, 'test'))
  const rootModule = await import(pathToFileURL(join(packageDir, 'src/index.ts')).href)
  const rootValueExportNames = Object.keys(rootModule).sort()
  const runtimeDependencyNames = Object.keys(json.dependencies ?? {}).sort()

  return {
    name: pkg.name,
    dir: relative(REPO_ROOT, packageDir),
    source: {
      files: sourceFiles.length,
      loc: loc(sourceFiles),
    },
    test: {
      files: testFiles.length,
      loc: loc(testFiles),
    },
    public: {
      rootValueExports: rootValueExportNames.length,
      rootValueExportNames,
      subpathExports: exportMapSubpaths(json.exports).length,
      subpathExportNames: exportMapSubpaths(json.exports),
    },
    runtimeDependencies: {
      count: runtimeDependencyNames.length,
      names: runtimeDependencyNames,
    },
    boundaryExceptions: [],
  }
}

export async function collectReleaseCandidateMetrics(): Promise<ReleaseCandidateMetrics> {
  const packages = await Promise.all(PUBLIC_PACKAGES.map((pkg) => packageMetrics(pkg)))
  return {
    schemaVersion: 1,
    packages,
    totals: {
      sourceFiles: packages.reduce((sum, pkg) => sum + pkg.source.files, 0),
      sourceLoc: packages.reduce((sum, pkg) => sum + pkg.source.loc, 0),
      testFiles: packages.reduce((sum, pkg) => sum + pkg.test.files, 0),
      testLoc: packages.reduce((sum, pkg) => sum + pkg.test.loc, 0),
      publicRootValueExports: packages.reduce((sum, pkg) => sum + pkg.public.rootValueExports, 0),
      publicSubpathExports: packages.reduce((sum, pkg) => sum + pkg.public.subpathExports, 0),
      runtimeDependencies: packages.reduce((sum, pkg) => sum + pkg.runtimeDependencies.count, 0),
      boundaryExceptions: packages.reduce((sum, pkg) => sum + pkg.boundaryExceptions.length, 0),
    },
  }
}

if (import.meta.main) {
  const metrics = await collectReleaseCandidateMetrics()
  console.log(JSON.stringify(metrics, null, 2))
}
