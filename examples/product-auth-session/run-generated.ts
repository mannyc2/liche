import { run } from '@liche/core'
const mod = await import('./liche.generated.js')
await run(mod.default, process.argv.slice(2))
