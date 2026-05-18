import { describe, test, expect } from 'bun:test'
import { Glob } from 'bun'

const FORBIDDEN = ['@lili/build', '@lili/releases']

describe('package boundary: @lili/core', () => {
  test('does not import @lili/build or @lili/releases', async () => {
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
})
