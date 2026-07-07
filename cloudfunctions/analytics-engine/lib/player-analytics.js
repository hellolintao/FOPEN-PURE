const { analyticsPlayerId, pairKey } = require('./ids')
const { opponentSide, resultRoleForMember, sideMembers, subjectSide } = require('./teams')

function buildPlayerAnalytics({ seasonId, memberId, rows, membersById, rankRowsByType }) {
  const relevantRows = (rows || [])
    .filter(row => row && row.resultStatus === 'confirmed' && Array.isArray(row.playerIds) && row.playerIds.includes(memberId))
    .sort((a, b) => timeOf(b) - timeOf(a))
  const singlesRows = relevantRows.filter(row => row.tournamentType !== 'doubles')
  const doublesRows = relevantRows.filter(row => row.tournamentType === 'doubles')
  return {
    _id: analyticsPlayerId(seasonId, memberId),
    seasonId,
    memberId,
    updatedAt: new Date(),
    sourceVersion: 1,
    singles: buildBucket({ rows: singlesRows, memberId, membersById, type: 'singles' }),
    doubles: buildBucket({ rows: doublesRows, memberId, membersById, type: 'doubles' }),
    recentMatches: relevantRows.slice(0, 10).map(row => formatRecent(row, memberId, membersById)),
    lastSettlementImpact: null,
    rankSnapshot: rankRowsByType || { singles: [], doubles: [] }
  }
}

function buildBucket({ rows, memberId, membersById, type }) {
  const wins = rows.filter(row => resultRoleForMember(row, memberId) === 'winner').length
  const losses = rows.filter(row => resultRoleForMember(row, memberId) === 'loser').length
  return {
    matchWinCount: wins,
    matchLossCount: losses,
    lastFive: buildLastFive(rows, memberId),
    bestPartners: type === 'doubles' ? buildBestPartners(rows, memberId, membersById) : [],
    teamH2H: type === 'doubles' ? buildTeamH2H(rows, memberId, membersById) : [],
    strongAgainst: buildOpponentRecords(rows, memberId, membersById).filter(row => row.wins > row.losses),
    strugglesAgainst: buildOpponentRecords(rows, memberId, membersById).filter(row => row.losses >= row.wins)
  }
}

function buildLastFive(rows, memberId) {
  const list = rows.slice(0, 5).map(row => (resultRoleForMember(row, memberId) === 'winner' ? 'W' : 'L'))
  const wins = list.filter(value => value === 'W').length
  const losses = list.filter(value => value === 'L').length
  return { results: list, wins, losses, summary: `${wins}W-${losses}L` }
}

function buildBestPartners(rows, memberId, membersById) {
  const map = new Map()
  for (const row of rows) {
    const subject = subjectSide(row, memberId)
    for (const member of sideMembers(subject)) {
      if (member.memberId === memberId) continue
      const current = map.get(member.memberId) || {
        memberId: member.memberId,
        name: memberName(membersById, member.memberId, member.name),
        wins: 0,
        losses: 0,
        matches: 0
      }
      current.matches += 1
      if (resultRoleForMember(row, memberId) === 'winner') current.wins += 1
      else current.losses += 1
      current.winRate = current.matches > 0 ? current.wins / current.matches : 0
      map.set(member.memberId, current)
    }
  }
  return [...map.values()].sort((a, b) => b.winRate - a.winRate || b.matches - a.matches || a.memberId.localeCompare(b.memberId))
}

function buildTeamH2H(rows, memberId, membersById) {
  const map = new Map()
  for (const row of rows) {
    const subject = sideMembers(subjectSide(row, memberId)).map(member => ({
      ...member,
      name: memberName(membersById, member.memberId, member.name)
    }))
    const opponent = sideMembers(opponentSide(row, memberId)).map(member => ({
      ...member,
      name: memberName(membersById, member.memberId, member.name)
    }))
    if (subject.length !== 2 || opponent.length !== 2) continue
    const subjectKey = pairKey(subject.map(member => member.memberId)).pairId
    const opponentKey = pairKey(opponent.map(member => member.memberId)).pairId
    const key = `${subjectKey}__vs__${opponentKey}`
    const current = map.get(key) || {
      key,
      subjectTeam: subject,
      opponentTeam: opponent,
      wins: 0,
      losses: 0,
      recentMatches: []
    }
    const role = resultRoleForMember(row, memberId)
    if (role === 'winner') current.wins += 1
    else if (role === 'loser') current.losses += 1
    current.recentMatches.push(formatRecent(row, memberId, membersById))
    current.recentMatches = current.recentMatches
      .sort((a, b) => timeOf({ confirmedAt: b.confirmedAt }) - timeOf({ confirmedAt: a.confirmedAt }))
      .slice(0, 3)
    map.set(key, current)
  }
  return [...map.values()].sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses) || a.key.localeCompare(b.key))
}

function buildOpponentRecords(rows, memberId, membersById) {
  const map = new Map()
  for (const row of rows) {
    const opponents = sideMembers(opponentSide(row, memberId))
    for (const opponent of opponents) {
      const current = map.get(opponent.memberId) || {
        memberId: opponent.memberId,
        name: memberName(membersById, opponent.memberId, opponent.name),
        wins: 0,
        losses: 0,
        matches: 0
      }
      current.matches += 1
      if (resultRoleForMember(row, memberId) === 'winner') current.wins += 1
      else current.losses += 1
      current.winRate = current.matches > 0 ? current.wins / current.matches : 0
      map.set(opponent.memberId, current)
    }
  }
  return [...map.values()].sort((a, b) => b.matches - a.matches || a.memberId.localeCompare(b.memberId))
}

function formatRecent(row, memberId, membersById) {
  const subject = sideMembers(subjectSide(row, memberId)).map(member => ({
    ...member,
    name: memberName(membersById, member.memberId, member.name)
  }))
  const opponent = sideMembers(opponentSide(row, memberId)).map(member => ({
    ...member,
    name: memberName(membersById, member.memberId, member.name)
  }))
  return {
    matchId: row._id,
    tournamentId: row.tournamentId || '',
    tournamentType: row.tournamentType || 'singles',
    confirmedAt: row.confirmedAt || row.createTime || null,
    won: resultRoleForMember(row, memberId) === 'winner',
    pointsAwarded: pointsFor(row, memberId),
    subjectTeam: subject,
    opponentTeam: opponent
  }
}

function pointsFor(row, memberId) {
  const entries = (row && row.pointsAwarded && row.pointsAwarded.entries) || []
  const entry = entries.find(item => item.memberId === memberId)
  return entry ? Number(entry.points) || 0 : 0
}

function memberName(membersById, memberId, fallback) {
  const member = membersById && membersById.get(memberId)
  return (member && member.name) || fallback || memberId
}

function timeOf(row) {
  return new Date((row && (row.confirmedAt || row.createTime)) || 0).getTime() || 0
}

module.exports = { buildPlayerAnalytics, buildBucket, buildLastFive, buildTeamH2H, formatRecent }
