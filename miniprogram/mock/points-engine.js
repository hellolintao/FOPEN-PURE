const { members, singlesRanks, doublesRanks, recentMatches } = require('./data')

function rankRows(type = 'singles') {
  const rows = type === 'doubles' ? doublesRanks : singlesRanks
  const memberMap = Object.fromEntries(members.map(member => [member._id, member]))
  return rows.map(([memberId, totalPoints, winCount, lossCount]) => {
    const member = memberMap[memberId] || {}
    return {
      _id: memberId,
      name: member.name || memberId,
      avatarUrl: member.avatarUrl || '',
      totalPoints,
      winCount,
      lossCount
    }
  })
}

function playerStats(playerId) {
  const singles = rankRows('singles').find(item => item._id === playerId)
  const doubles = rankRows('doubles').find(item => item._id === playerId)
  return {
    stats: {
      singles: {
        winCount: singles ? singles.winCount : 0,
        lossCount: singles ? singles.lossCount : 0,
        totalPoints: singles ? singles.totalPoints : 0
      },
      doubles: {
        winCount: doubles ? doubles.winCount : 0,
        lossCount: doubles ? doubles.lossCount : 0,
        totalPoints: doubles ? doubles.totalPoints : 0
      }
    },
    recent: recentMatches
  }
}

/**
 * @param {{ action: string, type?: 'singles'|'doubles', playerId?: string }} event
 * @returns {{ success: boolean, data?: object, error?: { code: string, message: string } }}
 */
function main(event = {}) {
  if (event.action === 'rankList' || event.action === 'rankAggregate') {
    return { success: true, data: { rankList: rankRows(event.type) } }
  }
  if (event.action === 'playerStats') {
    return { success: true, data: playerStats(event.playerId) }
  }
  return { success: false, error: { code: 'UNKNOWN_ACTION', message: event.action || '' } }
}

module.exports = {
  main,
  rankRows,
  playerStats
}
