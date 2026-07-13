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

function patternBindsName(pattern, name) {
  if (!pattern) return false
  if (pattern.type === 'Identifier') return pattern.name === name
  if (pattern.type === 'RestElement') return patternBindsName(pattern.argument, name)
  if (pattern.type === 'AssignmentPattern') return patternBindsName(pattern.left, name)
  if (pattern.type === 'ArrayPattern') {
    return pattern.elements.some(element => patternBindsName(element, name))
  }
  if (pattern.type === 'ObjectPattern') {
    return pattern.properties.some(property => (
      property.type === 'RestElement'
        ? patternBindsName(property.argument, name)
        : patternBindsName(property.value, name)
    ))
  }
  return false
}

function statementBindsName(statement, name) {
  if (!statement) return false
  if (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') {
    return statementBindsName(statement.declaration, name)
  }
  if (statement.type === 'ImportDeclaration') {
    return statement.specifiers.some(specifier => specifier.local && specifier.local.name === name)
  }
  if (statement.type === 'VariableDeclaration') {
    return statement.declarations.some(declaration => patternBindsName(declaration.id, name))
  }
  if (statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') {
    return !!statement.id && statement.id.name === name
  }
  return false
}

function expectedRegistrationName(relative) {
  if (relative === 'miniprogram/app.js') return 'App'
  if (relative.startsWith('miniprogram/pages/') && path.extname(relative) === '.js') return 'Page'
  return ''
}

function uniqueTopLevelRegistration(ast, name) {
  if (!name || ast.program.body.some(statement => statementBindsName(statement, name))) return null
  const registrations = ast.program.body
    .filter(statement => statement.type === 'ExpressionStatement')
    .map(statement => statement.expression)
    .filter(expression => (
      expression.type === 'CallExpression' &&
      expression.callee.type === 'Identifier' &&
      expression.callee.name === name
    ))
  if (registrations.length !== 1) return null
  return registrations[0].arguments[0] && registrations[0].arguments[0].type === 'ObjectExpression'
    ? registrations[0]
    : null
}

function directRegistrationOwner(node, ancestors, validRegistration) {
  if (!validRegistration) return null
  let member = node
  let config = ancestors[ancestors.length - 1]
  let registration = ancestors[ancestors.length - 2]

  if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
    member = config
    config = ancestors[ancestors.length - 2]
    registration = ancestors[ancestors.length - 3]
    if (!isFunctionProperty(member)) return null
  } else if (node.type !== 'ObjectMethod' || node.kind !== 'method') {
    return null
  }

  if (!config || config.type !== 'ObjectExpression') return null
  if (registration !== validRegistration || registration.arguments[0] !== config) return null
  return {
    registration: registration.callee.name,
    methodName: objectMemberName(member)
  }
}

function collectIdentityCalls(ast, validRegistration) {
  const calls = []
  function visit(node, owner = null, ancestors = []) {
    if (Array.isArray(node)) {
      node.forEach(child => visit(child, owner, ancestors))
      return
    }
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return

    const nextOwner = isFunctionNode(node)
      ? directRegistrationOwner(node, ancestors, validRegistration)
      : owner
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
  const registration = uniqueTopLevelRegistration(ast, expectedRegistrationName(relative))
  collectIdentityCalls(ast, registration).forEach(({ node, owner }) => {
    const index = node.loc.start.line - 1
    const text = lines[index] || ''

    if (relative === 'miniprogram/app.js') {
      if (!owner || owner.registration !== 'App' || owner.methodName !== 'onLaunch') {
        addFinding(findings, relative, index + 1, 'launch-eager-member-identity', text)
      }
      return
    }

    if (!relative.startsWith('miniprogram/pages/')) return
    const isAllowedPageMethod = owner && owner.registration === 'Page' &&
      ALLOWED_PAGE_IDENTITY_METHODS[relative] === owner.methodName
    if (!isAllowedPageMethod) {
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
