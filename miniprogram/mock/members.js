const { members } = require('./data')

/**
 * @param {{ action: string, _id?: string }} event
 * @returns {{ success: boolean, data?: object|Array, error?: { code: string, message: string } }}
 */
function main(event = {}) {
  if (event.action === 'get') {
    return { success: true, data: members }
  }
  if (event.action === 'getById') {
    return { success: true, data: members.find(member => member._id === event._id) || null }
  }
  if (event.action === 'list') {
    return { success: true, data: { list: members, total: members.length } }
  }
  return { success: false, error: { code: 'UNKNOWN_ACTION', message: event.action || '' } }
}

module.exports = {
  main
}
