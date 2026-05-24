const PUBLIC_PACKAGES = ['@liche/core', '@liche/build', '@liche/product', '@liche/releases'] as const

type PackageRegistryStatus =
  | {
      name: string
      status: 'published'
      latest: string | null
      registryUrl: string
    }
  | {
      name: string
      status: 'no_public_package'
      latest: null
      registryUrl: string
    }
  | {
      name: string
      status: 'registry_error'
      latest: null
      registryUrl: string
      httpStatus: number
      message: string
    }

type NpmAvailabilityReport = {
  schemaVersion: 1
  checkedAt: string
  registry: 'https://registry.npmjs.org'
  packages: PackageRegistryStatus[]
  note: string
}

function registryUrl(name: string): string {
  return `https://registry.npmjs.org/${encodeURIComponent(name)}`
}

export async function checkNpmPackageAvailability(
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<NpmAvailabilityReport> {
  const packages: PackageRegistryStatus[] = []

  for (const name of PUBLIC_PACKAGES) {
    const url = registryUrl(name)
    const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
    if (response.status === 404) {
      packages.push({ name, status: 'no_public_package', latest: null, registryUrl: url })
      continue
    }
    if (!response.ok) {
      packages.push({
        name,
        status: 'registry_error',
        latest: null,
        registryUrl: url,
        httpStatus: response.status,
        message: response.statusText || 'registry request failed',
      })
      continue
    }

    const body = await response.json() as { 'dist-tags'?: { latest?: string } }
    packages.push({
      name,
      status: 'published',
      latest: body['dist-tags']?.latest ?? null,
      registryUrl: url,
    })
  }

  return {
    schemaVersion: 1,
    checkedAt: now.toISOString(),
    registry: 'https://registry.npmjs.org',
    packages,
    note: 'no_public_package means the public registry did not return a package. It does not prove @liche organization ownership or publish rights.',
  }
}

if (import.meta.main) {
  const report = await checkNpmPackageAvailability()
  console.log(JSON.stringify(report, null, 2))
}
