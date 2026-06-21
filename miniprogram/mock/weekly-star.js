const { rankRows } = require('./points-engine')

function withWeeklyFields(row, points, trend) {
  return {
    ...row,
    points,
    weeklyPoints: points,
    trend
  }
}

/**
 * @param {{ action: string, seasonId?: string }} event
 * @returns {{ success: boolean, data?: object, error?: { code: string, message: string } }}
 */
function main(event = {}) {
  if (event.action !== 'latest' && event.action !== 'current') {
    return { success: false, error: { code: 'UNKNOWN_ACTION', message: event.action || '' } }
  }

  if (event.action === 'current') {
    const type = event.type === 'doubles' ? 'doubles' : 'singles'
    const row = type === 'doubles' ? rankRows('doubles')[0] : rankRows('singles')[1]
    return {
      success: true,
      data: {
        mode: 'current',
        weekStart: '2026-05-25',
        weekEnd: '2026-05-31',
        star: {
          memberId: row._id,
          name: row.name,
          avatarUrl: row.avatarUrl,
          pointsDelta: type === 'doubles' ? 94 : 86,
          wins: 3,
          losses: 1
        },
        subtitle: `上周积分 +${type === 'doubles' ? 94 : 86} · W-L 3-1`
      }
    }
  }

  return {
    success: true,
    data: {
      _id: `${event.seasonId || 's2026'}_ws_2026-05-11`,
      seasonId: event.seasonId || 's2026',
      weekId: 'ws_2026-05-11',
      weekStart: '2026-05-11',
      weekEnd: '2026-05-17',
      singlesStar: withWeeklyFields(rankRows('singles')[1], 86, 3),
      doublesStar: withWeeklyFields(rankRows('doubles')[0], 94, 2)
    }
  }
}

module.exports = {
  main
}
