const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'miniprogram_npm'])
const JS_EXT = new Set(['.js', '.wxml', '.json'])

function walk(dir, files = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) {
      if (name === '__tests__' || name === 'mock') continue
      walk(full, files)
    } else if (JS_EXT.has(path.extname(name))) {
      files.push(full)
    }
  }
  return files
}

function rel(file) {
  return path.relative(root, file)
}

function addFinding(findings, file, line, rule, text) {
  findings.push({ file: rel(file), line, rule, text: text.trim() })
}

function enclosingMethodName(lines, index) {
  const controlStatements = new Set(['if', 'for', 'while', 'switch', 'catch', 'with'])
  for (let i = index; i >= 0; i -= 1) {
    const match = lines[i].match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/)
    if (match && !controlStatements.has(match[1])) return match[1]
  }
  return ''
}

function isAllowedSilentIdentityRestore(relative, lines, index) {
  const allowedMethods = {
    'miniprogram/pages/home/index.js': 'ensureIdentity',
    'miniprogram/pages/mine/index.js': 'restoreIdentity',
    'miniprogram/pages/rank/index.js': '_ensureCurrentMember',
    'miniprogram/pages/tournament-detail/index.js': 'ensureIdentity'
  }
  return allowedMethods[relative] === enclosingMethodName(lines, index)
}

function isAllowedLaunchIdentityRestore(relative, lines, index) {
  return relative === 'miniprogram/app.js' && enclosingMethodName(lines, index) === 'onLaunch'
}

function scanFile(file, findings) {
  const relative = rel(file)
  const body = fs.readFileSync(file, 'utf8')
  const lines = body.split(/\r?\n/)

  lines.forEach((text, index) => {
    const line = index + 1

    if (relative.startsWith('miniprogram/') && /\bwx\.cloud\.database\s*\(/.test(text)) {
      addFinding(findings, file, line, 'frontend-direct-database', text)
    }

    if (relative.startsWith('miniprogram/') && /\bdb\.collection\s*\(/.test(text)) {
      addFinding(findings, file, line, 'frontend-direct-collection', text)
    }

    if (relative.startsWith('miniprogram/') && /\bcreatedByOpenid\b|\bopenid\b|\bopenId\b|\bunionid\b/.test(text)) {
      addFinding(findings, file, line, 'frontend-internal-identifier', text)
    }

    if (
      relative === 'miniprogram/app.js' &&
      /identityReady\s*=\s*this\.refreshIdentity\s*\(/.test(text) &&
      !isAllowedLaunchIdentityRestore(relative, lines, index)
    ) {
      addFinding(findings, file, line, 'launch-eager-member-identity', text)
    }

    if (
      relative.startsWith('miniprogram/pages/') &&
      /\.refreshIdentity\s*\(/.test(text)
    ) {
      const nearby = lines.slice(Math.max(0, index - 12), index + 1).join('\n')
      const gatedByOfficialPrivacy = /options\.requirePrivacy/.test(nearby) &&
        /ensureOfficialPrivacyAuthorization/.test(nearby)
      if (!gatedByOfficialPrivacy && !isAllowedSilentIdentityRestore(relative, lines, index)) {
        addFinding(findings, file, line, 'page-eager-member-identity', text)
      }
    }

    if (relative === 'miniprogram/pages/edit-profile/index.js' && /publicProfileConsent\s*[:=]\s*true/.test(text)) {
      addFinding(findings, file, line, 'registration-forces-public-profile', text)
    }

    if (/\b(wx\.getLocation|wx\.chooseLocation|wx\.openLocation|wx\.startLocationUpdate|scope\.userLocation)\b/.test(text)) {
      addFinding(findings, file, line, 'location-api', text)
    }
  })
}

const files = [
  ...walk(path.join(root, 'miniprogram')),
  ...walk(path.join(root, 'cloudfunctions'))
]

const findings = []
files.forEach(file => scanFile(file, findings))

if (findings.length > 0) {
  console.error('Privacy adversarial scan failed:')
  findings.forEach(item => {
    console.error(`${item.file}:${item.line} [${item.rule}] ${item.text}`)
  })
  process.exit(1)
}

console.log('Privacy adversarial scan passed')
