#!/usr/bin/env bun
import cli from './lili.generated.js'

await cli.serve(process.argv.slice(2))

