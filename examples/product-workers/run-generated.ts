#!/usr/bin/env bun
import { run } from '@liche/core'
import cli from './liche.generated.js'

await run(cli, process.argv.slice(2))
