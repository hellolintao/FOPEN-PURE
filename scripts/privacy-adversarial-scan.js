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

function addFinding(findings, relative, line, rule, text) {
  findings.push({ file: relative, line, rule, text: text.trim() })
}

const CONTROL_STATEMENTS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with'])
const METHOD_DECLARATION_PATTERNS = [
  /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/,
  /^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?function\s*\([^)]*\)\s*\{/,
  /^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/
]

function maskNonCode(body) {
  return body.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g,
    value => value.replace(/[^\r\n]/g, ' ')
  )
}

function findClosingBrace(code, openIndex) {
  let depth = 0
  for (let i = openIndex; i < code.length; i += 1) {
    if (code[i] === '{') {
      depth += 1
    } else if (code[i] === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }

  return -1
}

function lineStartOffsets(body, lineCount) {
  const offsets = []
  let offset = 0
  for (let i = 0; i < lineCount; i += 1) {
    offsets.push(offset)
    const newline = body.indexOf('\n', offset)
    offset = newline === -1 ? body.length : newline + 1
  }
  return offsets
}

function findMethodRanges(body, lines, offsets) {
  const code = maskNonCode(body)
  const ranges = []
  lines.forEach((text, index) => {
    for (const pattern of METHOD_DECLARATION_PATTERNS) {
      const match = text.match(pattern)
      if (!match || CONTROL_STATEMENTS.has(match[1])) continue
      const openIndex = offsets[index] + match.index + match[0].lastIndexOf('{')
      const closeIndex = findClosingBrace(code, openIndex)
      if (closeIndex !== -1) ranges.push({ name: match[1], openIndex, closeIndex })
      break
    }
  })
  return ranges
}

function enclosingMethodName(ranges, targetIndex) {
  const enclosing = ranges
    .filter(({ openIndex, closeIndex }) => openIndex < targetIndex && targetIndex < closeIndex)
    .sort((left, right) => right.openIndex - left.openIndex)[0]
  return enclosing ? enclosing.name : ''
}

function isAllowedSilentIdentityRestore(relative, methodName) {
  const allowedMethods = {
    'miniprogram/pages/home/index.js': 'ensureIdentity',
    'miniprogram/pages/mine/index.js': 'restoreIdentity',
    'miniprogram/pages/rank/index.js': '_ensureCurrentMember',
    'miniprogram/pages/tournament-detail/index.js': 'ensureIdentity'
  }
  return allowedMethods[relative] === methodName
}

function isAllowedLaunchIdentityRestore(relative, methodName) {
  return relative === 'miniprogram/app.js' && methodName === 'onLaunch'
}

function scanSource(relative, body) {
  const findings = []
  const lines = body.split(/\r?\n/)
  const offsets = lineStartOffsets(body, lines.length)
  const methodRanges = findMethodRanges(body, lines, offsets)

  lines.forEach((text, index) => {
    const line = index + 1
    const refreshIdentityIndex = text.indexOf('refreshIdentity')
    const methodName = refreshIdentityIndex === -1
      ? ''
      : enclosingMethodName(methodRanges, offsets[index] + refreshIdentityIndex)

    if (relative.startsWith('miniprogram/') && /\bwx\.cloud\.database\s*\(/.test(text)) {
      addFinding(findings, relative, line, 'frontend-direct-database', text)
    }

    if (relative.startsWith('miniprogram/') && /\bdb\.collection\s*\(/.test(text)) {
      addFinding(findings, relative, line, 'frontend-direct-collection', text)
    }

    if (relative.startsWith('miniprogram/') && /\bcreatedByOpenid\b|\bopenid\b|\bopenId\b|\bunionid\b/.test(text)) {
      addFinding(findings, relative, line, 'frontend-internal-identifier', text)
    }

    if (
      relative === 'miniprogram/app.js' &&
      /identityReady\s*=\s*this\.refreshIdentity\s*\(/.test(text) &&
      !isAllowedLaunchIdentityRestore(relative, methodName)
    ) {
      addFinding(findings, relative, line, 'launch-eager-member-identity', text)
    }

    if (
      relative.startsWith('miniprogram/pages/') &&
      /\.refreshIdentity\s*\(/.test(text)
    ) {
      const nearby = lines.slice(Math.max(0, index - 12), index + 1).join('\n')
      const gatedByOfficialPrivacy = /options\.requirePrivacy/.test(nearby) &&
        /ensureOfficialPrivacyAuthorization/.test(nearby)
      if (!gatedByOfficialPrivacy && !isAllowedSilentIdentityRestore(relative, methodName)) {
        addFinding(findings, relative, line, 'page-eager-member-identity', text)
      }
    }

    if (relative === 'miniprogram/pages/edit-profile/index.js' && /publicProfileConsent\s*[:=]\s*true/.test(text)) {
      addFinding(findings, relative, line, 'registration-forces-public-profile', text)
    }

    if (/\b(wx\.getLocation|wx\.chooseLocation|wx\.openLocation|wx\.startLocationUpdate|scope\.userLocation)\b/.test(text)) {
      addFinding(findings, relative, line, 'location-api', text)
    }
  })

  return findings
}

function scanFile(file) {
  return scanSource(rel(file), fs.readFileSync(file, 'utf8'))
}

function main() {
  const files = [
    ...walk(path.join(root, 'miniprogram')),
    ...walk(path.join(root, 'cloudfunctions'))
  ]
  const findings = files.flatMap(scanFile)

  if (findings.length > 0) {
    console.error('Privacy adversarial scan failed:')
    findings.forEach(item => {
      console.error(`${item.file}:${item.line} [${item.rule}] ${item.text}`)
    })
    process.exitCode = 1
    return findings
  }

  console.log('Privacy adversarial scan passed')
  return findings
}

if (require.main === module) main()

module.exports = { scanSource }
