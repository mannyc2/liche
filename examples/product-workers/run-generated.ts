#!/usr/bin/env bun
import cli from './liche.generated.js'

await cli.serve(process.argv.slice(2))

