'use strict'

const DEFAULTS = Object.freeze({
  12: {
    placement: { champion: 250, runnerUp: 150, semifinal: 100, quarterfinal: 65 },
    group: { win: 20, loss: 10 }
  },
  16: {
    placement: { champion: 500, runnerUp: 350, semifinal: 250, quarterfinal: 180 },
    group: { win: 50, loss: 25 }
  }
})

function buildGroupKnockoutPointEntries({ tournament, rows }) {
  const bracketSize = Number(tournament && tournament.bracketSize) || 16
  const rules = resolveRules(tournament, bracketSize)
  const confirmedRows = Array.isArray(rows) ? rows.filter(row => row && row.resultStatus === 'confirmed') : []
  const knockoutRows = confirmedRows.filter(row => row.stage === 'knockout')
  const groupRows = confirmedRows.filter(row => row.stage === 'group')
  const top8 = new Set()
  const entriesByMember = new Map()

  for (const row of knockoutRows.filter(row => Number(row.round) === 1)) {
    collectSideIds(row.player1).forEach(id => top8.add(id))
    collectSideIds(row.player2).forEach(id => top8.add(id))
  }

  const final = knockoutRows.find(row => Number(row.round) === 3 && winnerIdOf(row))
  if (final) {
    const championIds = collectWinnerIds(final)
    championIds.forEach(id => setPlacement(entriesByMember, id, 'champion', rules.placement.champion))
    collectSideIds(loserOf(final)).forEach(id => setPlacement(entriesByMember, id, 'runnerUp', rules.placement.runnerUp))
  }

  for (const row of knockoutRows.filter(row => Number(row.round) === 2)) {
    collectSideIds(loserOf(row)).forEach(id => setPlacement(entriesByMember, id, 'semifinal', rules.placement.semifinal))
  }
  for (const row of knockoutRows.filter(row => Number(row.round) === 1)) {
    collectSideIds(loserOf(row)).forEach(id => setPlacement(entriesByMember, id, 'quarterfinal', rules.placement.quarterfinal))
  }

  for (const row of groupRows) {
    const winnerId = winnerIdOf(row)
    for (const side of [row.player1, row.player2]) {
      for (const memberId of collectSideIds(side)) {
        if (top8.has(memberId)) continue
        const current = entriesByMember.get(memberId) || { memberId, rank: 'group', points: 0 }
        current.points += winnerId === memberId ? rules.group.win : rules.group.loss
        entriesByMember.set(memberId, current)
      }
    }
  }

  return [...entriesByMember.values()]
}

function resolveRules(tournament, bracketSize) {
  const fallback = DEFAULTS[bracketSize] || DEFAULTS[16]
  const configured = tournament &&
    tournament.pointsRules &&
    tournament.pointsRules.groupKnockout &&
    tournament.pointsRules.groupKnockout[String(bracketSize)]
  if (!configured) return cloneRules(fallback)
  return {
    placement: { ...fallback.placement, ...(configured.placement || {}) },
    group: { ...fallback.group, ...(configured.group || {}) }
  }
}

function cloneRules(rules) {
  return {
    placement: { ...rules.placement },
    group: { ...rules.group }
  }
}

function setPlacement(entriesByMember, memberId, rank, points) {
  if (!memberId || entriesByMember.has(memberId)) return
  entriesByMember.set(memberId, { memberId, rank, points })
}

function loserOf(row) {
  const winnerId = winnerIdOf(row)
  if (!winnerId) return null
  if (collectSideIds(row.player1).includes(winnerId)) return row.player2 || null
  if (collectSideIds(row.player2).includes(winnerId)) return row.player1 || null
  return null
}

function collectWinnerIds(row) {
  if (row && row.winner) {
    const ids = collectSideIds(row.winner)
    if (ids.length > 0) return ids
  }
  const id = winnerIdOf(row)
  return id ? [id] : []
}

function winnerIdOf(row) {
  return sideId(row && row.winner) || row && (row.winnerId || row.winnerMemberId) || ''
}

function collectSideIds(side) {
  if (!side) return []
  const ids = [sideId(side)]
  if (side.partnerId) ids.push(side.partnerId)
  return ids.filter(Boolean)
}

function sideId(side) {
  return side && (side.id || side.memberId || side.playerId || side._id)
}

module.exports = { buildGroupKnockoutPointEntries }
