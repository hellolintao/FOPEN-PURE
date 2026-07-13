const fs = require('fs')
const path = require('path')
const { parse } = require('@babel/parser')

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

const ALLOWED_PAGE_IDENTITY_METHODS = {
  'miniprogram/pages/home/index.js': 'ensureIdentity',
  'miniprogram/pages/mine/index.js': 'restoreIdentity',
  'miniprogram/pages/rank/index.js': '_ensureCurrentMember',
  'miniprogram/pages/tournament-detail/index.js': 'ensureIdentity'
}

function objectMemberName(node) {
  if (node.computed) return ''
  if (node.key.type === 'Identifier') return node.key.name
  if (node.key.type === 'StringLiteral') return node.key.value
  return ''
}

function isFunctionProperty(node) {
  return node.type === 'ObjectProperty' && (
    node.value.type === 'FunctionExpression' || node.value.type === 'ArrowFunctionExpression'
  )
}

function isRefreshIdentityCall(node) {
  if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return false
  const callee = node.callee
  if (!callee || (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression')) return false
  if (callee.computed) return callee.property.type === 'StringLiteral' && callee.property.value === 'refreshIdentity'
  return callee.property.type === 'Identifier' && callee.property.name === 'refreshIdentity'
}

function isFunctionNode(node) {
  return [
    'ObjectMethod',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'FunctionDeclaration',
    'ClassMethod',
    'ClassPrivateMethod'
  ].includes(node.type)
}

function directRegistrationOwner(node, ancestors) {
  let member = node
  let config = ancestors[ancestors.length - 1]
  let registration = ancestors[ancestors.length - 2]

  if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
    member = config
    config = ancestors[ancestors.length - 2]
    registration = ancestors[ancestors.length - 3]
    if (!isFunctionProperty(member)) return null
  } else if (node.type !== 'ObjectMethod') {
    return null
  }

  if (!config || config.type !== 'ObjectExpression') return null
  if (!registration || registration.type !== 'CallExpression') return null
  if (registration.arguments[0] !== config || registration.callee.type !== 'Identifier') return null
  if (registration.callee.name !== 'App' && registration.callee.name !== 'Page') return null
  return {
    registration: registration.callee.name,
    methodName: objectMemberName(member)
  }
}

function collectIdentityCalls(ast) {
  const calls = []
  function visit(node, owner = null, ancestors = []) {
    if (Array.isArray(node)) {
      node.forEach(child => visit(child, owner, ancestors))
      return
    }
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return

    const nextOwner = isFunctionNode(node) ? directRegistrationOwner(node, ancestors) : owner
    if (isRefreshIdentityCall(node)) calls.push({ node, owner: nextOwner })
    const nextAncestors = [...ancestors, node]
    Object.values(node).forEach(child => visit(child, nextOwner, nextAncestors))
  }

  visit(ast)
  return calls
}

function scanIdentityRestores(relative, body, lines) {
  if (path.extname(relative) !== '.js') return []

  let ast
  try {
    ast = parse(body, { sourceType: 'unambiguous' })
  } catch (err) {
    const findings = []
    addFinding(
      findings,
      relative,
      (err.loc && err.loc.line) || 1,
      'javascript-parse-failed',
      err.message
    )
    return findings
  }

  const findings = []
  collectIdentityCalls(ast).forEach(({ node, owner }) => {
    const index = node.loc.start.line - 1
    const text = lines[index] || ''

    if (relative === 'miniprogram/app.js') {
      if (!owner || owner.registration !== 'App' || owner.methodName !== 'onLaunch') {
        addFinding(findings, relative, index + 1, 'launch-eager-member-identity', text)
      }
      return
    }

    if (!relative.startsWith('miniprogram/pages/')) return
    const nearby = lines.slice(Math.max(0, index - 12), index + 1).join('\n')
    const gatedByOfficialPrivacy = /options\.requirePrivacy/.test(nearby) &&
      /ensureOfficialPrivacyAuthorization/.test(nearby)
    const isAllowedPageMethod = owner && owner.registration === 'Page' &&
      ALLOWED_PAGE_IDENTITY_METHODS[relative] === owner.methodName
    if (!gatedByOfficialPrivacy && !isAllowedPageMethod) {
      addFinding(findings, relative, index + 1, 'page-eager-member-identity', text)
    }
  })
  return findings
}

function scanSource(relative, body) {
  const lines = body.split(/\r?\n/)
  const findings = scanIdentityRestores(relative, body, lines)

  lines.forEach((text, index) => {
    const line = index + 1

    if (relative.startsWith('miniprogram/') && /\bwx\.cloud\.database\s*\(/.test(text)) {
      addFinding(findings, relative, line, 'frontend-direct-database', text)
    }

    if (relative.startsWith('miniprogram/') && /\bdb\.collection\s*\(/.test(text)) {
      addFinding(findings, relative, line, 'frontend-direct-collection', text)
    }

    if (relative.startsWith('miniprogram/') && /\bcreatedByOpenid\b|\bopenid\b|\bopenId\b|\bunionid\b/.test(text)) {
      addFinding(findings, relative, line, 'frontend-internal-identifier', text)
    }

    if (relative === 'miniprogram/pages/edit-profile/index.js' && /publicProfileConsent\s*[:=]\s*true/.test(text)) {
      addFinding(findings, relative, line, 'registration-forces-public-profile', text)
    }

    if (/\b(wx\.getLocation|wx\.chooseLocation|wx\.openLocation|wx\.startLocationUpdate|scope\.userLocation)\b/.test(text)) {
      addFinding(findings, relative, line, 'location-api', text)
    }
  })

  return findings.sort((left, right) => left.line - right.line)
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
