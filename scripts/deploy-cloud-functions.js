#!/usr/bin/env node

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const projectRoot = path.resolve(__dirname, '..')
const cloudRoot = path.join(projectRoot, 'cloudfunctions')
const defaultCli = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'

function usage() {
  console.error('Usage: node scripts/deploy-cloud-functions.js --env <env-id> <function-name> [function-name...]')
  console.error('Example: node scripts/deploy-cloud-functions.js --env cloud1-xxx seasons match-results')
}

function parseArgs(argv) {
  const args = [...argv]
  let envId = process.env.FOPEN_CLOUD_ENV || process.env.CLOUD_ENV_ID || ''
  const names = []

  while (args.length) {
    const arg = args.shift()
    if (arg === '--env' || arg === '-e') {
      envId = args.shift() || ''
    } else if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    } else {
      names.push(arg)
    }
  }

  if (!envId) throw new Error('Missing env id. Pass --env or set FOPEN_CLOUD_ENV.')
  if (names.length === 0) throw new Error('Missing function name.')
  return { envId, names }
}

function readAppId() {
  const configPath = path.join(projectRoot, 'project.config.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (!config.appid) throw new Error(`Missing appid in ${configPath}`)
  return config.appid
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function shouldSkip(relPath) {
  const parts = relPath.split(path.sep)
  return parts.some(part => (
    part === 'node_modules' ||
    part === 'coverage' ||
    part === '__tests__' ||
    part === '.git'
  ))
}

function walkFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const abs = path.join(dir, entry.name)
    const rel = path.relative(base, abs)
    if (shouldSkip(rel)) return []
    if (entry.isDirectory()) return walkFiles(abs, base)
    if (!entry.isFile()) return []
    return [rel]
  })
}

function flatJsName(relPath) {
  if (relPath === 'index.js') return 'index.js'
  return relPath.replace(/\.js$/, '').split(path.sep).join('_') + '.js'
}

function normalizeModulePath(modulePath) {
  return modulePath.split('/').join(path.sep)
}

function resolveLocalRequire(currentRel, request, jsByRel) {
  if (!request.startsWith('.')) return ''
  const currentDir = path.dirname(currentRel)
  const base = path.normalize(path.join(currentDir, normalizeModulePath(request)))
  const candidates = [
    `${base}.js`,
    path.join(base, 'index.js')
  ].map(candidate => path.normalize(candidate))
  return candidates.find(candidate => jsByRel.has(candidate)) || ''
}

function rewriteRequires(source, currentRel, jsByRel) {
  return source.replace(/require\((['"])(\.[^'"]+)\1\)/g, (full, quote, request) => {
    const targetRel = resolveLocalRequire(currentRel, request, jsByRel)
    if (!targetRel) return full
    const flat = `./${flatJsName(targetRel).replace(/\.js$/, '')}`
    return `require(${quote}${flat}${quote})`
  })
}

function prepareFunction(functionName, buildRoot) {
  const sourceDir = path.join(cloudRoot, functionName)
  if (!fs.existsSync(sourceDir)) throw new Error(`Cloud function not found: ${sourceDir}`)

  const outDir = path.join(buildRoot, functionName)
  ensureDir(outDir)

  const files = walkFiles(sourceDir)
  const jsFiles = files.filter(file => file.endsWith('.js'))
  const jsByRel = new Set(jsFiles.map(file => path.normalize(file)))

  for (const rel of files) {
    const sourcePath = path.join(sourceDir, rel)
    if (rel.endsWith('.js')) {
      const targetPath = path.join(outDir, flatJsName(rel))
      const rewritten = rewriteRequires(fs.readFileSync(sourcePath, 'utf8'), path.normalize(rel), jsByRel)
      fs.writeFileSync(targetPath, rewritten)
      continue
    }

    if (rel.includes(path.sep)) {
      throw new Error(`Unsupported nested non-JS file in ${functionName}: ${rel}`)
    }
    fs.copyFileSync(sourcePath, path.join(outDir, rel))
  }

  return outDir
}

function runDeploy(cliPath, appId, envId, paths) {
  const args = [
    'cloud',
    'functions',
    'deploy',
    '--appid',
    appId,
    '--env',
    envId,
    '--paths',
    ...paths,
    '--remote-npm-install'
  ]
  const result = spawnSync(cliPath, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const output = `${result.stdout || ''}${result.stderr || ''}${result.error ? result.error.message : ''}`
  process.stdout.write(output)
  return {
    status: result.status === null ? 1 : result.status,
    output
  }
}

function deployWithRetry(cliPath, appId, envId, paths) {
  const maxAttempts = 4
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = runDeploy(cliPath, appId, envId, paths)
    const updating = /FailedOperation\.UpdateFunctionCode|updating/i.test(result.output)
    const failed = result.status !== 0 || /\[error\]/.test(result.output) || /│\s+false\s+│/.test(result.output)
    if (!failed) return
    if (!updating || attempt === maxAttempts) {
      throw new Error('WeChat DevTools CLI reported a deploy failure.')
    }
    const delayMs = 15000
    console.log(`Cloud function is updating. Retrying in ${delayMs / 1000}s (${attempt}/${maxAttempts})...`)
    spawnSync('sleep', [String(delayMs / 1000)])
  }
}

function main() {
  const { envId, names } = parseArgs(process.argv.slice(2))
  const cliPath = process.env.WECHAT_DEVTOOLS_CLI || defaultCli
  if (!fs.existsSync(cliPath)) throw new Error(`WeChat DevTools CLI not found: ${cliPath}`)

  const appId = readAppId()
  const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fopen-clouddeploy-'))
  const keepBuild = process.env.KEEP_CLOUD_DEPLOY_BUILD === '1'

  try {
    const deployPaths = names.map(name => prepareFunction(name, buildRoot))
    console.log(`Prepared deploy package: ${buildRoot}`)
    deployWithRetry(cliPath, appId, envId, deployPaths)
  } finally {
    if (keepBuild) {
      console.log(`Keeping deploy package: ${buildRoot}`)
    } else {
      fs.rmSync(buildRoot, { recursive: true, force: true })
    }
  }
}

try {
  main()
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
