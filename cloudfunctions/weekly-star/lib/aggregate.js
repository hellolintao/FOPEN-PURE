async function aggregateRanks({ db, seasonId, type, pageSize = 100, asOf = null }) {
  const _ = db.command
  const acc = new Map()
  const limit = Math.max(1, Math.min(Number(pageSize) || 100, 100))
  const cutoff = asOf ? new Date(asOf) : null

  const matchBase = { seasonId, resultStatus: 'confirmed', tournamentType: type }
  const matchFilter = cutoff
    ? _.and([matchBase, _.or([
        { confirmedAt: _.lte(cutoff) },
        _.and([{ confirmedAt: _.eq(null) }, { createTime: _.lte(cutoff) }])
      ])])
    : matchBase

  await pageCollection({
    db,
    baseFilter: matchFilter,
    limit,
    collectionName: 'match_results',
    visit: async (m) => {
      const entries = (m.pointsAwarded && m.pointsAwarded.entries) || []
      for (const e of entries) accumulate(acc, e.memberId, e.points, e.role)
    },
    command: _
  })

  const tpBase = { seasonId, tournamentType: type }
  const tpFilter = cutoff
    ? _.and([tpBase, _.or([
        { awardedAt: _.lte(cutoff) },
        _.and([{ awardedAt: _.eq(null) }, { createTime: _.lte(cutoff) }])
      ])])
    : tpBase

  await safePageTournamentPoints(db, tpFilter, limit, async (p) => {
    accumulate(acc, p.memberId, p.points, null)
  }, _)

  return [...acc.entries()]
    .map(([memberId, v]) => ({ memberId, ...v }))
    .sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
      if (b.wins !== a.wins) return b.wins - a.wins
      if (a.losses !== b.losses) return a.losses - b.losses
      return a.memberId < b.memberId ? -1 : (a.memberId > b.memberId ? 1 : 0)
    })
}

async function pageCollection({ db, collectionName, baseFilter, limit, visit, command }) {
  let last = null
  for (let skip = 0, safety = 0; safety < 1000; safety++, skip += limit) {
    const coll = db.collection(collectionName)
    const offsetQuery = coll.where(baseFilter).orderBy('createTime', 'asc').orderBy('_id', 'asc')
    let page
    if (offsetQuery && typeof offsetQuery.skip === 'function') {
      page = ((await offsetQuery.skip(skip).limit(limit).get()).data) || []
    } else {
      const filter = last
        ? command.and([
            baseFilter,
            command.or([
              { createTime: command.gt(last.createTime) },
              command.and([{ createTime: last.createTime }, { _id: command.gt(last._id) }])
            ])
          ])
        : baseFilter
      page = ((await coll.where(filter).orderBy('createTime', 'asc').orderBy('_id', 'asc').limit(limit).get()).data) || []
    }
    for (const row of page) await visit(row)
    if (page.length < limit) break
    last = { createTime: page[page.length - 1].createTime, _id: page[page.length - 1]._id }
  }
}

async function safePageTournamentPoints(db, filter, pageSize, visit, command) {
  try {
    await pageCollection({ db, collectionName: 'tournament_points', baseFilter: filter, limit: pageSize, visit, command })
  } catch (e) {
    const text = `${(e && (e.errMsg || e.message || e.code)) || ''}`
    if ((e && e.errCode === -502005) || /collection not exists|Db or Table not exist|not exist/i.test(text)) return
    throw e
  }
}

function accumulate(acc, memberId, points, role) {
  const cur = acc.get(memberId) || { totalPoints: 0, wins: 0, losses: 0 }
  cur.totalPoints += points || 0
  if (role === 'winner') cur.wins += 1
  if (role === 'loser') cur.losses += 1
  acc.set(memberId, cur)
}

module.exports = { aggregateRanks }
