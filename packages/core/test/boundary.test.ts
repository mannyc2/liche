import { describe, test, expect } from 'bun:test'
import { Glob } from 'bun'

const FORBIDDEN = ['@lili/build', '@lili/product', '@lili/releases']
const FORBIDDEN_RUNTIME_DEPS = ['@toon-format/toon']

describe('package boundary: @lili/core', () => {
  test('does not import @lili/build, @lili/product, or @lili/releases', async () => {
    const glob = new Glob('src/**/*.ts')
    const offenders: { file: string; match: string }[] = []
    for await (const file of glob.scan({ cwd: import.meta.dir.replace(/\/test$/, '') })) {
      const text = await Bun.file(`${import.meta.dir.replace(/\/test$/, '')}/${file}`).text()
      for (const f of FORBIDDEN) {
        if (text.includes(f)) offenders.push({ file, match: f })
      }
    }
    expect(offenders).toEqual([])
  })

  test('does not declare optional renderer packages as runtime dependencies', async () => {
    const pkg = await Bun.file(`${import.meta.dir.replace(/\/test$/, '')}/package.json`).json()
    const deps = { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies }
    expect(FORBIDDEN_RUNTIME_DEPS.filter((name) => name in deps)).toEqual([])
  })
})
