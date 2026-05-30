import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createTarGz } from './archives/tar.js'
import type { TarEntry } from './archives/tar.js'
import {
  commandName,
  metadataLines,
  packageArtifact,
  readBinary,
  safeLowerSegment,
  targetSuffix,
  validateHasBinaries,
  verifiedPath,
  writeArtifact,
} from './common.js'
import type { BinaryTarget, CliReleaseManifest, PackageRecord } from '../manifest/index.js'
import type { ReleaseRenderer, ReleaseRendererInput, RenderPackageResult } from './index.js'

export type NpmRendererConfig = {
  packageName?: string
  packageScope?: string
  commandName?: string
  pack?: boolean
}

type NpmPackageFile = {
  path: string
  data: Uint8Array | string
  mode?: number
}

const NPM_OS = {
  darwin: 'darwin',
  linux: 'linux',
  windows: 'win32',
} as const

function scopedNpmName(base: string, scope?: string): string {
  if (!scope) return base
  const normalizedScope = safeLowerSegment(scope.replace(/^@/, ''))
  return `@${normalizedScope}/${base}`
}

function npmPackageName(manifest: CliReleaseManifest, config: unknown): string {
  const cfg = config as NpmRendererConfig | undefined
  if (cfg?.packageName) return cfg.packageName
  return scopedNpmName(safeLowerSegment(manifest.runtime.command), cfg?.packageScope)
}

function npmPlatformPackageName(umbrellaName: string, binary: BinaryTarget): string {
  const suffix = targetSuffix(binary)
  if (umbrellaName.startsWith('@')) {
    const [scope, name] = umbrellaName.split('/')
    return `${scope}/${name}-${suffix}`
  }
  return `${umbrellaName}-${suffix}`
}

function npmTarballFileName(packageName: string, version: string): string {
  return `${packageName.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`
}

function npmPackageDirName(packageName: string): string {
  return packageName.replace(/^@/, '').replace(/\//g, '-')
}

function repository(manifest: CliReleaseManifest): Record<string, string> | undefined {
  return manifest.metadata.repository
}

function npmUmbrellaPackageJson(
  manifest: CliReleaseManifest,
  name: string,
  command: string,
  optionalDependencies: Record<string, string>,
): Record<string, unknown> {
  const pkg: Record<string, unknown> = {
    name,
    version: manifest.release.version,
    description: manifest.metadata.description,
    type: 'module',
    bin: { [command]: `./bin/${command}.js` },
    files: [`bin/${command}.js`, 'README.md', 'package.json'],
    optionalDependencies,
  }
  if (manifest.metadata.license) pkg.license = manifest.metadata.license
  if (manifest.metadata.homepage) pkg.homepage = manifest.metadata.homepage
  const repo = repository(manifest)
  if (repo) pkg.repository = repo
  return pkg
}

function npmPlatformPackageJson(
  manifest: CliReleaseManifest,
  name: string,
  binary: BinaryTarget,
): Record<string, unknown> {
  const pkg: Record<string, unknown> = {
    name,
    version: manifest.release.version,
    description: `${manifest.subject.name} binary for ${targetSuffix(binary)}`,
    os: [NPM_OS[binary.platform]],
    cpu: [binary.arch],
    files: [`bin/${binary.filename}`, 'README.md', 'package.json'],
  }
  if (binary.platform === 'linux' && binary.libc) pkg.libc = binary.libc
  if (manifest.metadata.license) pkg.license = manifest.metadata.license
  if (manifest.metadata.homepage) pkg.homepage = manifest.metadata.homepage
  const repo = repository(manifest)
  if (repo) pkg.repository = repo
  return pkg
}

function npmShim(
  command: string,
  version: string,
  packages: Array<{ name: string; binary: string; target: string }>,
): string {
  return `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const packages = ${JSON.stringify(packages, null, 2)};
const wanted = {
  platform: process.platform,
  arch: process.arch,
  libc: process.platform === "linux" && process.report?.getReport?.().header?.glibcVersionRuntime ? "glibc" : undefined,
};

function candidateMatches(candidate) {
  if (candidate.target.includes("windows") && wanted.platform !== "win32") return false;
  if (candidate.target.includes("darwin") && wanted.platform !== "darwin") return false;
  if (candidate.target.includes("linux") && wanted.platform !== "linux") return false;
  if (candidate.target.includes("arm64") && wanted.arch !== "arm64") return false;
  if (candidate.target.includes("x64") && wanted.arch !== "x64") return false;
  if (candidate.target.includes("musl") && wanted.libc === "glibc") return false;
  return true;
}

const attempted = [];
for (const candidate of packages.filter(candidateMatches)) {
  try {
    const packageJson = require.resolve(candidate.name + "/package.json");
    const pkg = require(packageJson);
    if (pkg.version !== ${JSON.stringify(version)}) {
      attempted.push(candidate.name + " version " + pkg.version + " != ${version}");
      continue;
    }
    const bin = join(dirname(packageJson), "bin", candidate.binary);
    if (!existsSync(bin)) {
      attempted.push(candidate.name + " missing " + bin);
      continue;
    }
    const result = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
    if (result.error) {
      attempted.push(candidate.name + " failed to spawn: " + result.error.message);
      continue;
    }
    process.exit(result.status ?? 0);
  } catch (error) {
    attempted.push(candidate.name + ": " + error.message);
  }
}

console.error(${JSON.stringify(command)} + " could not find a compatible packaged binary.");
console.error("Install optional dependencies, avoid --omit=optional, or choose a supported platform.");
if (attempted.length > 0) console.error("Attempted:\\n" + attempted.map(item => " - " + item).join("\\n"));
process.exit(1);
`
}

function packEnabled(config: unknown): boolean {
  return (config as NpmRendererConfig | undefined)?.pack ?? true
}

async function writePackageDirectory(root: string, files: readonly NpmPackageFile[]): Promise<void> {
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  for (const file of files) {
    const path = join(root, file.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, file.data)
    if (file.mode !== undefined) await chmod(path, file.mode)
  }
}

function packageTarEntries(files: readonly NpmPackageFile[]): TarEntry[] {
  return files.map((file) => {
    const entry: TarEntry = {
      path: `package/${file.path}`,
      data: file.data,
    }
    if (file.mode !== undefined) entry.mode = file.mode
    return entry
  })
}

async function packPackageDirectory(
  input: ReleaseRendererInput,
  packageName: string,
  version: string,
  files: readonly NpmPackageFile[],
): Promise<Awaited<ReturnType<typeof writeArtifact>>> {
  const fileName = npmTarballFileName(packageName, version)
  const outDir = join(input.outDir, 'tarballs')
  await mkdir(outDir, { recursive: true })
  return writeArtifact(join(outDir, fileName), createTarGz(packageTarEntries(files)))
}

async function renderNpm(input: ReleaseRendererInput): Promise<RenderPackageResult> {
  const name = npmPackageName(input.manifest, input.config)
  const command = commandName(input.manifest, input.config)
  const version = input.manifest.release.version
  const platformPackages = input.manifest.binaries.map((binary) => ({
    binary,
    name: npmPlatformPackageName(name, binary),
  }))
  const optionalDependencies = Object.fromEntries(platformPackages.map((pkg) => [pkg.name, version]))

  const packages: PackageRecord[] = []
  const artifacts: Array<{ packageId: string; path: string }> = []
  const packageDirs = join(input.outDir, 'package-dirs')
  const shouldPack = packEnabled(input.config)

  for (const { binary, name: platformName } of platformPackages) {
    const binaryBytes = await readBinary(verifiedPath(input, binary.id))
    const files: NpmPackageFile[] = [
      {
        path: 'package.json',
        data: `${JSON.stringify(npmPlatformPackageJson(input.manifest, platformName, binary), null, 2)}\n`,
      },
      { path: 'README.md', data: metadataLines(input.manifest) },
      { path: `bin/${binary.filename}`, data: binaryBytes, mode: 0o755 },
    ]
    await writePackageDirectory(join(packageDirs, npmPackageDirName(platformName)), files)
    const packageId = `npm:${platformName}`
    const record: PackageRecord = {
      id: packageId,
      renderer: 'npm',
      ecosystem: 'npm',
      kind: 'npm-platform',
      name: platformName,
      version,
      targetBinaryId: binary.id,
    }
    if (shouldPack) {
      const artifact = await packPackageDirectory(input, platformName, version, files)
      record.artifact = packageArtifact(artifact)
      artifacts.push({ packageId, path: artifact.path })
    }
    packages.push(record)
  }

  const shimPackages = platformPackages.map(({ binary, name }) => ({
    name,
    binary: binary.filename,
    target: binary.target,
  }))
  const umbrellaFiles: NpmPackageFile[] = [
    {
      path: 'package.json',
      data: `${JSON.stringify(npmUmbrellaPackageJson(input.manifest, name, command, optionalDependencies), null, 2)}\n`,
    },
    { path: 'README.md', data: metadataLines(input.manifest) },
    { path: `bin/${command}.js`, data: npmShim(command, version, shimPackages), mode: 0o755 },
  ]
  await writePackageDirectory(join(packageDirs, npmPackageDirName(name)), umbrellaFiles)
  const umbrellaId = `npm:${name}`
  const umbrellaRecord: PackageRecord = {
    id: umbrellaId,
    renderer: 'npm',
    ecosystem: 'npm',
    kind: 'npm-umbrella',
    name,
    version,
  }
  if (shouldPack) {
    const umbrella = await packPackageDirectory(input, name, version, umbrellaFiles)
    umbrellaRecord.artifact = packageArtifact(umbrella)
    artifacts.push({ packageId: umbrellaId, path: umbrella.path })
  }
  packages.push(umbrellaRecord)

  return { packages, artifacts }
}

export const npmRenderer: ReleaseRenderer = {
  id: 'npm',
  validate: ({ manifest }) => validateHasBinaries(manifest, 'npm'),
  render: renderNpm,
}
