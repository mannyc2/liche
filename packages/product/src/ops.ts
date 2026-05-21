export type ProductPackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn'

export type ProductNotice = {
  id: string
  severity?: 'info' | 'warning' | 'critical'
  message: string
  since?: string
  url?: string
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
          : 'LILI_TELEMETRY',
        fileEnvVar: spec?.telemetry && typeof spec.telemetry === 'object' && spec.telemetry.fileEnvVar
          ? spec.telemetry.fileEnvVar
          : 'LILI_TELEMETRY_FILE',
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
  }
}
