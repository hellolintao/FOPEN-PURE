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
  if (event.action !== 'latest') {
    return { success: false, error: { code: 'UNKNOWN_ACTION', message: event.action || '' } }
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
