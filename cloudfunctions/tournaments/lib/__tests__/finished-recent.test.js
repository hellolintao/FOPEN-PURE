const { finishedRecent } = require('../handlers/finished-recent')

function makeCtx({ isAdmin = true, list = [] } = {}) {
  return {
    isAdmin,
    db: {
      listFinished: async (limit) => list.slice(0, limit),
    },
  }
}

test('finishedRecent FORBIDDEN: non-admin', async () => {
  const ctx = makeCtx({ isAdmin: false })
  await expect(finishedRecent(ctx, {})).rejects.toMatchObject({ code: 'FORBIDDEN' })
})

test('finishedRecent default limit 5', async () => {
  const list = Array.from({ length: 10 }).map((_, i) => ({
    _id: `t${i}`, name: `T${i}`, format: 'regular', completedAt: new Date(), winnerLabel: `W${i}`,
  }))
  const ctx = makeCtx({ list })
  const result = await finishedRecent(ctx, {})
  expect(result.items).toHaveLength(5)
})

test('finishedRecent custom limit clamps to 20', async () => {
  const list = Array.from({ length: 30 }).map((_, i) => ({ _id: `t${i}`, name: `T${i}`, completedAt: new Date() }))
  const ctx = makeCtx({ list })
  const result = await finishedRecent(ctx, { limit: 100 })
  expect(result.items).toHaveLength(20)
})

test('finishedRecent items shape', async () => {
  const ctx = makeCtx({ list: [{ _id: 't1', name: 'X', format: 'knockout', completedAt: new Date(), winnerLabel: 'W' }] })
  const result = await finishedRecent(ctx, {})
  expect(result.items[0]).toMatchObject({
    tournamentId: 't1', name: 'X', format: 'knockout', winnerLabel: 'W',
  })
  expect(result.items[0].completedAt).toBeDefined()
})

test('finishedRecent empty', async () => {
  const ctx = makeCtx({ list: [] })
  const result = await finishedRecent(ctx, {})
  expect(result.items).toEqual([])
})
