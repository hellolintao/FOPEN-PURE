const { createScheduledMatchResultService } = require('../scheduled-match-results')

function hasUndefined(value) {
  if (typeof value === 'undefined') return true
  if (Array.isArray(value)) return value.some(hasUndefined)
  if (isPlainObject(value)) return Object.values(value).some(hasUndefined)
  return false
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || value instanceof Date) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function makeDb() {
  const collections = {
    tournaments: new Map([
      ['tournament_1', { _id: 'tournament_1', seasonId: 'season_2026', type: 'singles' }]
    ]),
    match_results: new Map([
      ['result_1_m1', { _id: 'result_1_m1', tournamentId: 'tournament_1', resultStatus: 'pending' }]
    ]),
    tournament_brackets: new Map()
  }
  const writes = []

  const db = {
    command: {
      gt: value => ({ $gt: value }),
      in: values => ({ $in: values })
    },
    serverDate: () => 'SERVER_DATE',
    collection: name => ({
      doc: id => ({
        get: jest.fn(async () => {
          const row = collections[name] && collections[name].get(id)
          return row ? { data: row } : null
        }),
        update: jest.fn(async ({ data }) => {
          writes.push({ collection: name, id, data })
          if (hasUndefined(data)) throw new Error('document.update:fail -501007 invalid parameter')
          if (Object.prototype.hasOwnProperty.call(data, '_id')) {
            throw new Error('document.update:fail -501007 invalid parameters. 不能更新_id的值')
          }
          const current = collections[name].get(id) || { _id: id }
          collections[name].set(id, { ...current, ...data })
        }),
        remove: jest.fn(async () => {
          if (collections[name]) collections[name].delete(id)
        })
      }),
      add: jest.fn(async ({ data }) => {
        writes.push({ collection: name, id: data._id, data })
        if (hasUndefined(data)) throw new Error('collection.add:fail -501007 invalid parameter')
        collections[name].set(data._id, data)
        return { _id: data._id }
      }),
      where: jest.fn(() => ({
        get: jest.fn(async () => ({ data: [] }))
      }))
    })
  }

  return { db, writes }
}

test('upsertScheduledMatches strips undefined fields before updating score rows', async () => {
  const { db, writes } = makeDb()
  const service = createScheduledMatchResultService({ db, command: db.command })

  const result = await service.upsertScheduledMatches({
    tournamentId: 'tournament_1',
    matches: [{
      matchId: 'm1',
      round: 1,
      position: 1,
      player1: undefined,
      player2: { id: 'memberB', name: 'B' }
    }],
    queues: [{ courtId: 'c1', items: [{ kind: 'match', matchId: 'm1', order: undefined }] }]
  })

  expect(result).toEqual({ success: true, data: { count: 1 } })
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ collection: 'match_results', id: 'result_1_m1' })
  expect(hasUndefined(writes[0].data)).toBe(false)
  expect(writes[0].data).not.toHaveProperty('_id')
  expect(writes[0].data).not.toHaveProperty('player1')
  expect(writes[0].data).not.toHaveProperty('queueOrder')
})
