async function resolveCurrentWeeklyStar({ db, seasonId, type, week }) {
  const _ = db.command
  const start = week.start || week.weekStart
  const end = week.end || week.weekEnd

  const dateClause = _.or([
    _.and([{ confirmedAt: _.gte(start) }, { confirmedAt: _.lte(end) }]),
    _.and([{ confirmedAt: _.eq(null) }, { createTime: _.gte(start) }, { createTime: _.lte(end) }])
  ])
  const matchFilter = _.and([
    { seasonId },
    { resultStatus: 'confirmed' },
    { tournamentType: type },
    dateClause
  ])
  const matchesRes = await db.collection('match_results').where(matchFilter).get()
  const matches = (matchesRes && matchesRes.data) || []

  const tpFilter = _.and([
    { seasonId },
    { tournamentType: type },
    _.or([
      _.and([{ awardedAt: _.gte(start) }, { awardedAt: _.lte(end) }]),
      _.and([{ awardedAt: _.eq(null) }, { createTime: _.gte(start) }, { createTime: _.lte(end) }])
    ])
  ])
  let placements = []
  try {
    const tpRes = await db.collection('tournament_points').where(tpFilter).get()
    placements = (tpRes && tpRes.data) || []
  } catch (e) {
    const msg = `${(e && (e.errMsg || e.message || e.code)) || ''}`
    if (!((e && e.errCode === -502005) || /not exist/i.test(msg))) throw e
  }

  if (matches.length === 0 && placements.length === 0) {
    return await fallbackOrEmpty({ db, seasonId, type, week })
  }

  const agg = new Map()
  for (const m of matches) {
    const entries = (m.pointsAwarded && m.pointsAwarded.entries) || []
    for (const e of entries) {
      const cur = agg.get(e.memberId) || { points: 0, wins: 0, losses: 0 }
      cur.points += e.points || 0
      if (e.role === 'winner') cur.wins += 1
      if (e.role === 'loser') cur.losses += 1
      agg.set(e.memberId, cur)
    }
  }
  for (const p of placements) {
    const cur = agg.get(p.memberId) || { points: 0, wins: 0, losses: 0 }
    cur.points += p.points || 0
    agg.set(p.memberId, cur)
  }

  if (agg.size === 0) return await fallbackOrEmpty({ db, seasonId, type, week })

  const ranked = [...agg.entries()].map(([memberId, v]) => ({ memberId, ...v }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points
      if (b.wins !== a.wins) return b.wins - a.wins
      if (a.losses !== b.losses) return a.losses - b.losses
      return a.memberId < b.memberId ? -1 : (a.memberId > b.memberId ? 1 : 0)
    })
  const top = ranked[0]
  const member = await fetchMember(db, top.memberId)

  return {
    mode: 'current',
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    star: {
      memberId: top.memberId,
      name: member.name || top.memberId,
      avatarUrl: member.avatarUrl || '',
      pointsDelta: top.points,
      wins: top.wins,
      losses: top.losses
    },
    subtitle: `本周积分 +${top.points} · W-L ${top.wins}-${top.losses}`
  }
}

async function fallbackOrEmpty({ db, seasonId, type, week }) {
  const starsRes = await db.collection('weekly_stars')
    .where({ seasonId })
    .orderBy('weekStart', 'desc')
    .limit(5)
    .get()
  const stars = (starsRes && starsRes.data) || []
  const key = type === 'singles' ? 'singlesStar' : 'doublesStar'
  for (const s of stars) {
    if (s[key] && s[key].memberId) {
      const memberId = s[key].memberId
      const member = await fetchMember(db, memberId)
      return {
        mode: 'fallback',
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        star: {
          memberId,
          name: member.name || memberId,
          avatarUrl: member.avatarUrl || '',
          pointsDelta: s[key].points || 0,
          wins: s[key].wins || 0,
          losses: s[key].losses || 0
        },
        subtitle: '等本周首场'
      }
    }
  }
  return { mode: 'empty', weekStart: week.weekStart, weekEnd: week.weekEnd, star: null, subtitle: null }
}

async function fetchMember(db, memberId) {
  const res = await db.collection('members').where({ _id: memberId }).get()
  return (res && res.data && res.data[0]) || {}
}

module.exports = { resolveCurrentWeeklyStar }
