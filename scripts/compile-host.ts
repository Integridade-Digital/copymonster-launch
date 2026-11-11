/**
 * Run the Host aggregate compiler with a bounded old-space heap.
 *
 * `package.json` cannot derive the ceiling itself, and passing a fixed
 * `--max-old-space-size` let one compile reserve more memory than a small host
 * has. See `tsc-heap.ts` for how the ceiling is chosen.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hostHeapArgs } from './tsc-heap.ts'

const compiler = fileURLToPath(import.meta.resolve('typescript/bin/tsc'))
const heapLimit = hostHeapArgs()[0] ?? '--max-old-space-size=4096'
const child = spawn(process.execPath, [heapLimit, compiler, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: 'inherit',
})

child.on('error', (error: unknown) => {
  console.error(`compile-host: failed to start the Host compiler: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal !== null) {
    console.error(`compile-host: the Host compiler was terminated by ${signal}`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
