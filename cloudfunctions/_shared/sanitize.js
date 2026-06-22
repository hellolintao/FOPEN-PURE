function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined)
  if (isPlainObject(value)) {
    return Object.entries(value).reduce((out, [key, item]) => {
      if (typeof item !== 'undefined') out[key] = stripUndefined(item)
      return out
    }, {})
  }
  return value
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || value instanceof Date) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

module.exports = {
  stripUndefined
}
