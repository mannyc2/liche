export type ProductPackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn'
export type ProductReleaseChannel = 'stable' | 'next' | 'canary'
export type ProductReleaseInstallManager = ProductPackageManager | 'pipx' | 'homebrew' | 'scoop' | 'binary'
export type ProductReleasePackageEcosystem = 'npm' | 'pypi' | 'homebrew' | 'scoop'

export type ProductNotice = {
  id: string
  severity?: 'info' | 'warning' | 'critical'
  message: string
  since?: string
  url?: string
}

export type ProductReleaseInstall = {
  manager: ProductReleaseInstallManager
  command: string
  url?: string
}

export type ProductReleasePackage = {
  id?: string
  ecosystem: ProductReleasePackageEcosystem
  kind: string
  name: string
  version: string
  channel?: string
}

export type ProductReleaseManifestReference = {
  path?: string
  digest?: string
  sha256?: string
}

export type ProductYankedVersion = ProductNotice & {
  version: string
}

export type ProductReleaseSpec = {
  version: string
  channel?: ProductReleaseChannel
  createdAt?: string
  latestVersion?: string
  manifest?: ProductReleaseManifestReference
  install?: readonly ProductReleaseInstall[]
  packages?: readonly ProductReleasePackage[]
  yankedVersions?: readonly ProductYankedVersion[]
}

export type ProductOpsSpec = {
  doctor?: boolean | {
    packageManagers?: readonly ProductPackageManager[]
  }
  telemetry?: false | {
    enabledEnvVar?: string
    fileEnvVar?: string
  }
  notices?: {
    updates?: readonly ProductNotice[]
    channels?: readonly ProductNotice[]
    yanks?: readonly ProductNotice[]
  }
  release?: false | ProductReleaseSpec
}

export const DEFAULT_OPS_PACKAGE_MANAGERS: readonly ProductPackageManager[] = ['bun', 'npm', 'pnpm', 'yarn']

export type NormalizedOpsSpec = {
  enabled: boolean
  doctor: false | {
    packageManagers: ProductPackageManager[]
  }
  telemetry: false | {
    enabledEnvVar: string
    fileEnvVar: string
  }
  notices: {
    updates: ProductNotice[]
    channels: ProductNotice[]
    yanks: ProductNotice[]
  }
  release: false | ProductReleaseSpec
}

export function normalizeOpsSpec(spec: ProductOpsSpec | undefined): NormalizedOpsSpec {
  const enabled = spec !== undefined
  const doctor = !enabled || spec?.doctor === false
    ? false
    : {
        packageManagers: spec?.doctor && typeof spec.doctor === 'object' && spec.doctor.packageManagers
          ? [...spec.doctor.packageManagers]
          : [...DEFAULT_OPS_PACKAGE_MANAGERS],
      }
  const telemetry = !enabled || spec?.telemetry === false
    ? false
    : {
        enabledEnvVar: spec?.telemetry && typeof spec.telemetry === 'object' && spec.telemetry.enabledEnvVar
          ? spec.telemetry.enabledEnvVar
          : 'LICHE_TELEMETRY',
        fileEnvVar: spec?.telemetry && typeof spec.telemetry === 'object' && spec.telemetry.fileEnvVar
          ? spec.telemetry.fileEnvVar
          : 'LICHE_TELEMETRY_FILE',
      }
  return {
    enabled,
    doctor,
    telemetry,
    notices: {
      updates: [...(spec?.notices?.updates ?? [])],
      channels: [...(spec?.notices?.channels ?? [])],
      yanks: [...(spec?.notices?.yanks ?? [])],
    },
    release: normalizeReleaseSpec(spec?.release),
  }
}

function normalizeReleaseSpec(spec: ProductOpsSpec['release']): false | ProductReleaseSpec {
  if (!spec) return false
  return {
    version: spec.version,
    ...(spec.channel ? { channel: spec.channel } : undefined),
    ...(spec.createdAt ? { createdAt: spec.createdAt } : undefined),
    ...(spec.latestVersion ? { latestVersion: spec.latestVersion } : undefined),
    ...(spec.manifest ? { manifest: { ...spec.manifest } } : undefined),
    ...(spec.install ? { install: spec.install.map((entry) => ({ ...entry })) } : undefined),
    ...(spec.packages ? { packages: spec.packages.map((entry) => ({ ...entry })) } : undefined),
    ...(spec.yankedVersions ? { yankedVersions: spec.yankedVersions.map((entry) => ({ ...entry })) } : undefined),
  }
}
