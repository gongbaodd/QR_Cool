import { spawn, spawnSync } from 'node:child_process'
import { chmod, mkdir, readFile, access, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'output/api-tests')
const fixturesDir = path.join(root, 'test/api/fixtures')
const apiDir = path.join(root, 'apps/render-api')
const require = createRequire(path.join(apiDir, 'package.json'))
const baseUrl = 'http://127.0.0.1:8799'
const token = randomBytes(32).toString('hex')
const args = new Set(process.argv.slice(2))
const includeLimits = args.has('--limits')
const smokeOnly = args.has('--smoke')
const serveOnly = args.has('--serve')

await mkdir(outputDir, { recursive: true })
await mkdir(path.join(outputDir, 'fixtures'), { recursive: true })

function requireCommand(command: string, versionArg = '--version') {
  const result = spawnSync(command, [versionArg], { cwd: root, encoding: 'utf8' })
  if (result.error || result.status !== 0)
    throw new Error(`Required command "${command}" is unavailable. Install it and try again.`)
  process.stdout.write(`${result.stdout.trim().split('\n')[0]}\n`)
}

function run(command: string, commandArgs: string[], options: { env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: root,
      env: { ...process.env, ...options.env },
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`))
    })
  })
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function ensureFixtures() {
  try {
    for (const filename of [
      'baseline.recipe.json',
      'transparent.recipe.json',
      'rotated.recipe.json',
      'invalid-utf8.bin',
      'invalid-schema.recipe.json',
      'invalid-renderer.recipe.json',
      'invalid-unknown-field.recipe.json',
      'invalid-required-field.recipe.json',
      'invalid-content.recipe.json',
      'invalid-base64.recipe.json',
      'invalid-dimensions.recipe.json',
      'invalid-png.recipe.json',
      'invalid-digest.recipe.json',
      'invalid-placement.recipe.json',
      'invalid-color.recipe.json',
      'expected/manifest.json',
    ])
      await access(path.join(fixturesDir, filename))
    for (const filename of [
      'oversized-request.json',
      'oversized-image.recipe.json',
      'oversized-dimensions.recipe.json',
    ])
      await access(path.join(outputDir, 'fixtures', filename))
  } catch {
    await run(process.execPath, ['--import', 'tsx', 'scripts/prepare-api-fixtures.ts'])
  }
  const fixtures = JSON.parse(await readFile(path.join(fixturesDir, 'expected/manifest.json'), 'utf8')) as Array<{
    name: string
    hashes: { 'poster.png': string; 'qr.png': string }
  }>
  return Object.fromEntries(
    fixtures.flatMap(({ name, hashes }) => [
      [`${name}_poster_sha`, hashes['poster.png']],
      [`${name}_qr_sha`, hashes['qr.png']],
    ]),
  )
}

async function runHurl(files: string[], report: string, hashes: Record<string, string>) {
  const generatedHurlDir = path.join(outputDir, 'hurl')
  await mkdir(generatedHurlDir, { recursive: true })
  const generatedFiles = []
  for (const file of files) {
    const source = await readFile(path.join(root, 'test/api/hurl', file), 'utf8')
    const resolved = source.replace(/# fixture-sha: ([a-z0-9_]+)\nsha256 == hex,0{64};/g, (_match, name: string) => {
      const hash = hashes[name]
      if (!hash) throw new Error(`Missing expected image hash "${name}".`)
      return `# fixture-sha: ${name}\nsha256 == hex,${hash};`
    })
    const destination = path.join(generatedHurlDir, file)
    await writeFile(destination, resolved)
    generatedFiles.push(destination)
  }
  await run('hurl', [
    '--test',
    '--jobs',
    '1',
    '--connect-timeout',
    '5s',
    '--max-time',
    '60s',
    '--file-root',
    '.',
    '--variable',
    `base_url=${baseUrl}`,
    '--variable',
    'bad_token=invalid-api-test-token',
    '--secret',
    `token=${token}`,
    '--report-junit',
    path.join(outputDir, report),
    ...generatedFiles,
  ])
}

async function startWorker() {
  const wranglerPackage = path.dirname(require.resolve('wrangler/package.json'))
  const wranglerEntrypoint = path.join(wranglerPackage, 'bin/wrangler.js')
  const sourceConfig = await readFile(path.join(apiDir, 'wrangler.jsonc'), 'utf8')
  if (
    !sourceConfig.includes('"$schema": "node_modules/wrangler/config-schema.json"') ||
    !sourceConfig.includes('"main": "src/index.ts"')
  )
    throw new Error('The render Worker config paths changed; update the test-only config derivation.')
  const schemaPath = path.relative(outputDir, path.join(apiDir, 'node_modules/wrangler/config-schema.json'))
  const entryPath = path.relative(outputDir, path.join(apiDir, 'src/index.ts'))
  const isolatedConfig = sourceConfig
    .replace('"$schema": "node_modules/wrangler/config-schema.json"', `"$schema": "${schemaPath}"`)
    .replace('"main": "src/index.ts"', `"main": "${entryPath}"`)
  if (isolatedConfig === sourceConfig) throw new Error('Could not derive the isolated test Worker configuration.')
  const configPath = path.join(outputDir, 'wrangler.render.jsonc')
  const localEnvPath = path.join(outputDir, 'render-worker.env')
  await writeFile(configPath, isolatedConfig)
  await writeFile(localEnvPath, `RENDER_API_TOKEN=${token}\n`, { mode: 0o600 })
  await chmod(localEnvPath, 0o600)
  const child = spawn(
    process.execPath,
    [
      wranglerEntrypoint,
      'dev',
      '--config',
      configPath,
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      '8799',
      '--persist-to',
      path.join(outputDir, 'wrangler-state'),
      '--env-file',
      localEnvPath,
      '--show-interactive-dev-session',
      'false',
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' },
    },
  )
  child.once('error', (error) => console.error(`Could not start local Worker: ${error.message}`))
  return child
}

async function waitForWorker(child: ReturnType<typeof spawn>) {
  const deadline = Date.now() + 60_000
  const workerExit = new Promise<string>((resolve) => {
    child.once('close', (code, signal) => resolve(`Local Worker exited before readiness (${code ?? signal}).`))
  })
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/__api_test_ready__`, { signal: AbortSignal.timeout(2_000) })
      if (response.status === 404) {
        const body = (await response.json()) as { error?: { code?: string } }
        if (body.error?.code === 'NOT_FOUND') return
      }
    } catch {
      // Wrangler is still starting or compiling the Worker.
    }
    const exited = await Promise.race([delay(500).then(() => ''), workerExit])
    if (exited) throw new Error(exited)
  }
  throw new Error('Local Worker did not become ready within 60 seconds.')
}

async function stopWorker(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
  child.kill('SIGTERM')
  await Promise.race([closed, delay(5_000)])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

if (!serveOnly) requireCommand('hurl')
const hashes = await ensureFixtures()
const worker = await startWorker()
try {
  await waitForWorker(worker)
  if (serveOnly) {
    console.log(`Local render Worker ready at ${baseUrl}`)
    console.log(`Local test bearer token: ${token}`)
    console.log('Press Ctrl+C to stop the Worker.')
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve)
      process.once('SIGTERM', resolve)
    })
  } else if (smokeOnly) {
    await runHurl(['smoke.hurl'], 'junit-smoke.xml', hashes)
  } else if (includeLimits) {
    // The configured token is limited to ten authenticated calls per minute.
    // Start each quota suite after a full idle interval to avoid a partial bucket.
    await delay(61_000)
    await runHurl(['limits.hurl'], 'junit-limits.xml', hashes)
    await delay(61_000)
    await runHurl(['rate-limit.hurl'], 'junit-rate-limit.xml', hashes)
  } else {
    await runHurl(['smoke.hurl'], 'junit-smoke.xml', hashes)
    await delay(61_000)
    await runHurl(['contract.hurl'], 'junit-contract.xml', hashes)
    await delay(61_000)
    await runHurl(['recipes.hurl'], 'junit-recipes.xml', hashes)
  }
  console.log(`Worker API report files are in ${path.relative(root, outputDir)}.`)
} finally {
  await stopWorker(worker)
  await rm(path.join(outputDir, 'render-worker.env'), { force: true })
}
