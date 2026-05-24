const mod = await import('./liche.generated.js')
await mod.default.serve(process.argv.slice(2))
