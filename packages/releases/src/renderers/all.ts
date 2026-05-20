import type { RendererRegistry } from './index.js'
import { homebrewRenderer } from './homebrew.js'
import { npmRenderer } from './npm.js'
import { pypiRenderer } from './pypi.js'
import { scoopRenderer } from './scoop.js'

export { homebrewRenderer } from './homebrew.js'
export type { HomebrewRendererConfig } from './homebrew.js'
export { npmRenderer } from './npm.js'
export type { NpmRendererConfig } from './npm.js'
export { pypiRenderer } from './pypi.js'
export type { PypiRendererConfig } from './pypi.js'
export { scoopRenderer } from './scoop.js'
export type { ScoopRendererConfig } from './scoop.js'

export function createDefaultRendererRegistry(): RendererRegistry {
  return {
    npm: npmRenderer,
    pypi: pypiRenderer,
    homebrew: homebrewRenderer,
    scoop: scoopRenderer,
  }
}
