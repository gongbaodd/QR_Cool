import { spawn, type ChildProcess } from 'node:child_process'

/**
 * Cucumber has no built-in web-server management like @playwright/test does.
 * This helper starts `pnpm start` once per run and reuses a server that is
 * already listening, mirroring `reuseExistingServer: !process.env.CI` in
 * playwright.config.ts.
 */

const BASE_URL = 'http://127.0.0.1:3000'
const STARTUP_TIMEOUT_MS = 120_000

let child: ChildProcess | undefined

async function isUp(): Promise<boolean> {
  try {
    const response = await fetch(BASE_URL)
    return response.ok
  } catch {
    return false
  }
}

export async function startServer(): Promise<void> {
  if (await isUp()) return
  // The process group must die with us: killing the pnpm wrapper alone orphans
  // the next-server child and leaves port 3000 occupied.
  child = spawn('pnpm', ['--filter', '@mahu-qr/web', 'start', '--hostname', '127.0.0.1'], {
    stdio: 'inherit',
    env: process.env,
    detached: true,
  })
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await isUp()) return
    if (child.exitCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`The app did not become reachable at ${BASE_URL}. Did "pnpm build" run?`)
}

export async function stopServer(): Promise<void> {
  // Only stop a server this run spawned; an externally started one stays up.
  if (!child) return
  const pid = child.pid
  child = undefined
  if (pid === undefined) return
  try {
    if (process.platform !== 'win32') {
      // Negative pid targets the whole detached group (pnpm + next-server).
      process.kill(-pid, 'SIGTERM')
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    // Already gone.
  }
  const deadline = Date.now() + 10_000
  while ((await isUp()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // Already gone.
  }
}
