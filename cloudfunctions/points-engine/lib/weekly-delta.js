async function aggregateWeeklyPlayerDelta({ db, seasonId, type, playerId, week }) {
  const _ = db.command
  if (!playerId || !week || !week.weekStart || !week.weekEnd) {
    return { pointsDelta: 0, wins: 0, losses: 0 }
  }

  const start = week.start || week.weekStart
  const end = week.end || week.weekEnd
  const dateClause = _.or([
    _.and([
      { confirmedAt: _.gte(start) },
      { confirmedAt: _.lte(end) }
    ]),
    _.and([
      { confirmedAt: _.eq(null) },
      { createTime: _.gte(start) },
      { createTime: _.lte(end) }
    ])
  ])

  const filter = _.and([
    { seasonId },
    { resultStatus: 'confirmed' },
    { tournamentType: type },
    { playerIds: _.in([playerId]) },
    dateClause
  ])

  const res = await db.collection('match_results').where(filter).get()
  const rows = (res && res.data) || []

  let pointsDelta = 0
  let wins = 0
  let losses = 0
  for (const m of rows) {
    const entries = (m.pointsAwarded && m.pointsAwarded.entries) || []
    const mine = entries.find(e => e.memberId === playerId)
    if (!mine) continue
    pointsDelta += mine.points || 0
    if (mine.role === 'winner') wins += 1
    else if (mine.role === 'loser') losses += 1
  }
  return { pointsDelta, wins, losses }
}

module.exports = { aggregateWeeklyPlayerDelta }
