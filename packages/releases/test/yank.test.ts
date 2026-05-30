import { describe, expect, test } from 'bun:test'
import { CliReleaseManifestSchema, planReleaseYank } from '../src/index.js'
import type { CliReleaseManifest, CliReleaseManifestInput } from '../src/index.js'

const ZERO_HASH = '0'.repeat(64)

function manifestInput(packages: CliReleaseManifestInput['packages']): CliReleaseManifestInput {
  return {
    manifestVersion: 1,
    metadata: { description: 'yank test fixture' },
    subject: {
      id: 'workers',
      name: 'Workers CLI',
      version: '0.1.0',
      commit: '0123456789abcdef0123456789abcdef01234567',
      contract: {
        kind: 'product-catalog',
        digest: 'sha256:fake-catalog',
      },
    },
    release: {
      version: '0.1.0',
      createdAt: '2026-05-19T12:00:00Z',
      generatorVersion: '0.0.0',
    },
    runtime: { command: 'workers' },
    binaries: [],
    packages,
  }
}

function parseManifest(input: CliReleaseManifestInput): CliReleaseManifest {
  const parsed = CliReleaseManifestSchema.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.message)
  return parsed.data
}

describe('planReleaseYank', () => {
  test('derives affected packages from manifest package records', () => {
    const manifest = parseManifest(
      manifestInput([
        {
          id: 'workers-npm',
          renderer: 'npm',
          ecosystem: 'npm',
          kind: 'umbrella',
          name: '@acme/workers',
          version: '0.1.0',
          artifact: {
            fileName: 'workers-0.1.0.tgz',
            sha256: ZERO_HASH,
            size: 42,
          },
          publish: {
            registry: 'https://registry.npmjs.org',
            channel: 'latest',
          },
        },
        {
          id: 'workers-homebrew',
          renderer: 'homebrew',
          ecosystem: 'homebrew',
          kind: 'formula',
          name: 'workers',
          version: '0.1.0',
          publish: {
            repository: 'acme/homebrew-tap',
          },
        },
      ]),
    )

    const plan = planReleaseYank(manifest)

    expect(plan).toEqual({
      dryRun: true,
      manifestVersion: 1,
      releaseVersion: '0.1.0',
      subject: {
        id: 'workers',
        name: 'Workers CLI',
        version: '0.1.0',
      },
      packages: [
        {
          packageId: 'workers-npm',
          renderer: 'npm',
          ecosystem: 'npm',
          kind: 'umbrella',
          name: '@acme/workers',
          version: '0.1.0',
          artifact: {
            fileName: 'workers-0.1.0.tgz',
            sha256: ZERO_HASH,
            size: 42,
          },
          publish: {
            registry: 'https://registry.npmjs.org',
            channel: 'latest',
          },
        },
        {
          packageId: 'workers-homebrew',
          renderer: 'homebrew',
          ecosystem: 'homebrew',
          kind: 'formula',
          name: 'workers',
          version: '0.1.0',
          publish: {
            repository: 'acme/homebrew-tap',
          },
        },
      ],
    })
  })

  test('does not require ecosystem-specific manual inputs when no packages exist', () => {
    const plan = planReleaseYank(parseManifest(manifestInput([])))

    expect(plan.packages).toEqual([])
  })
})
