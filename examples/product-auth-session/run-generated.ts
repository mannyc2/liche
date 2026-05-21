const mod = await import('./lili.generated.js')
await mod.default.serve(process.argv.slice(2))
