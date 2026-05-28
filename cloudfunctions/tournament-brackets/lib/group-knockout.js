const GROUP_CODES = ['A', 'B', 'C', 'D']
const GROUP_KNOCKOUT_PHASES = ['group_draft', 'group_published', 'group_completed', 'knockout_published', 'completed']
const SUPPORTED_BRACKET_SIZES = [12, 16]

const DEFAULT_POINTS = {
  12: {
    placement: { champion: 250, runnerUp: 150, semifinal: 100, quarterfinal: 65 },
    group: { win: 20, loss: 10 }
  },
  16: {
    placement: { champion: 500, runnerUp: 350, semifinal: 250, quarterfinal: 180 },
    group: { win: 50, loss: 25 }
  }
}

const GROUP_SLOT_PAIRS = {
  12: [[1, 2], [1, 3], [2, 3]],
  16: [[1, 4], [2, 3], [1, 3], [2, 4], [1, 2], [3, 4]]
}

const KNOCKOUT_PAIRINGS = [
  ['A1', 'C2'],
  ['B1', 'D2'],
  ['C1', 'A2'],
  ['D1', 'B2']
]

const KNOCKOUT_ROUNDS = [
  { round: 1, name: 'quarterfinal', matchCount: 4 },
  { round: 2, name: 'semifinal', matchCount: 2 },
  { round: 3, name: 'final', matchCount: 1 }
]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeTournamentId(tournamentId) {
  return String(tournamentId || '').replace(/^tournament_/, '')
}

function groupBracketDocId(tournamentId, groupCode) {
  return `bracket_${normalizeTournamentId(tournamentId)}_group_${groupCode}`
}

function knockoutBracketDocId(tournamentId, round) {
  return `bracket_${normalizeTournamentId(tournamentId)}_knockout_round_${round}`
}

function defaultGroupKnockoutPoints(bracketSize) {
  return clone(DEFAULT_POINTS[Number(bracketSize)] || DEFAULT_POINTS[16])
}

function expectedGroupSize(bracketSize) {
  const size = Number(bracketSize)
  return SUPPORTED_BRACKET_SIZES.includes(size) ? size / GROUP_CODES.length : 0
}

function validateGroupAssignments({ bracketSize, groups }) {
  const groupSize = expectedGroupSize(bracketSize)
  if (!groupSize) return ['签位规模必须是 12 或 16']
  if (!Array.isArray(groups)) return ['groups 必须是数组']

  const errors = []
  const supportedGroupCodes = new Set(GROUP_CODES)
  const groupsByCode = new Map()
  const duplicateGroupCodes = new Set()
  const seenPlayerIds = new Set()
  const duplicatePlayerIds = new Set()

  for (const group of groups) {
    const groupCode = group && group.groupCode
    if (!supportedGroupCodes.has(groupCode)) {
      errors.push(`${groupCode || '未知'}组不是支持的小组`)
      continue
    }
    if (groupsByCode.has(groupCode)) {
      duplicateGroupCodes.add(groupCode)
      continue
    }
    groupsByCode.set(groupCode, group)
  }

  for (const groupCode of duplicateGroupCodes) {
    errors.push(`${groupCode}组重复出现`)
  }

  for (const groupCode of GROUP_CODES) {
    const group = groupsByCode.get(groupCode)
    const slots = Array.isArray(group && group.slots) ? group.slots : []

    if (slots.length !== groupSize) {
      errors.push(`${groupCode}组必须有 ${groupSize} 位选手`)
    }

    const seenSlotNos = new Set()
    for (const slot of slots) {
      if (!slot || !Number.isInteger(slot.slotNo) || slot.slotNo < 1 || slot.slotNo > groupSize) {
        errors.push(`${groupCode}组包含无效签位`)
        continue
      }
      if (seenSlotNos.has(slot.slotNo)) {
        errors.push(`${groupCode}组签位 ${slot.slotNo} 重复`)
      }
      seenSlotNos.add(slot.slotNo)

      if (!slot.playerId) {
        errors.push(`${groupCode}组 ${slot.slotNo} 号签缺少选手`)
        continue
      }
      if (seenPlayerIds.has(slot.playerId)) {
        duplicatePlayerIds.add(slot.playerId)
      }
      seenPlayerIds.add(slot.playerId)
    }
  }

  for (const playerId of duplicatePlayerIds) {
    errors.push(`选手 ${playerId} 重复出现在多个小组`)
  }

  return errors
}

function regToPlayer(registration) {
  if (!registration) return null
  return {
    id: registration.playerId || registration.id,
    name: registration.playerName || registration.name,
    registrationId: registration.registrationId || registration._id || null
  }
}

function slotByNo(group, slotNo) {
  return (group.slots || []).find(slot => slot.slotNo === slotNo)
}

function groupRoundForPair(bracketSize, pairIndex) {
  return Number(bracketSize) === 16 ? Math.floor(pairIndex / 2) + 1 : pairIndex + 1
}

function generateGroupMatches({ tournamentId, bracketSize, groups, now }) {
  const timestamp = now || Date.now()
  const normalizedTournamentId = normalizeTournamentId(tournamentId)
  const pairs = GROUP_SLOT_PAIRS[Number(bracketSize)] || []
  const groupsByCode = new Map((groups || []).map(group => [group.groupCode, group]))
  const matches = []

  for (const groupCode of GROUP_CODES) {
    const group = groupsByCode.get(groupCode)
    if (!group) continue

    for (let pairIndex = 0; pairIndex < pairs.length; pairIndex++) {
      const [slotNo1, slotNo2] = pairs[pairIndex]
      const position = matches.length + 1
      matches.push({
        matchId: `gk_${normalizedTournamentId}_g${groupCode}_p${position}_${timestamp}`,
        tournamentId,
        bracketId: groupBracketDocId(tournamentId, groupCode),
        matchKind: 'group',
        stage: 'group',
        groupCode,
        groupSlot1: slotNo1,
        groupSlot2: slotNo2,
        round: groupRoundForPair(bracketSize, pairIndex),
        position,
        type: 'singles',
        player1: regToPlayer(slotByNo(group, slotNo1)),
        player2: regToPlayer(slotByNo(group, slotNo2)),
        bye: false,
        status: 'pending',
        resultStatus: 'pending',
        winner: null,
        courtId: null,
        queueOrder: null
      })
    }
  }

  return matches
}

function seedToPlayer(seed) {
  if (!seed) return null
  return {
    id: seed.playerId || seed.id,
    name: seed.playerName || seed.name,
    registrationId: seed.registrationId || seed._id || null
  }
}

function buildKnockoutMatch({ tournamentId, normalizedTournamentId, round, position, timestamp, player1, player2, player1Source, player2Source }) {
  const match = {
    matchId: `gk_${normalizedTournamentId}_ko_r${round}_p${position}_${timestamp}`,
    tournamentId,
    bracketId: knockoutBracketDocId(tournamentId, round),
    matchKind: 'bracket',
    stage: 'knockout',
    round,
    position,
    type: 'singles',
    player1,
    player2,
    bye: false,
    status: 'pending',
    resultStatus: 'pending',
    winner: null,
    courtId: null,
    queueOrder: null
  }

  if (player1Source) match.player1Source = player1Source
  if (player2Source) match.player2Source = player2Source
  return match
}

function generateKnockoutMatches({ tournamentId, seeds, now }) {
  const timestamp = now || Date.now()
  const normalizedTournamentId = normalizeTournamentId(tournamentId)

  return KNOCKOUT_ROUNDS.map(roundConfig => {
    const matches = []
    for (let index = 0; index < roundConfig.matchCount; index++) {
      const position = index + 1
      const pairing = roundConfig.round === 1 ? KNOCKOUT_PAIRINGS[index] : null
      matches.push(buildKnockoutMatch({
        tournamentId,
        normalizedTournamentId,
        round: roundConfig.round,
        position,
        timestamp,
        player1: pairing ? seedToPlayer(seeds && seeds[pairing[0]]) : null,
        player2: pairing ? seedToPlayer(seeds && seeds[pairing[1]]) : null,
        player1Source: pairing && pairing[0],
        player2Source: pairing && pairing[1]
      }))
    }

    return {
      _id: knockoutBracketDocId(tournamentId, roundConfig.round),
      bracketId: knockoutBracketDocId(tournamentId, roundConfig.round),
      tournamentId,
      format: 'group_knockout',
      type: 'singles',
      stage: 'knockout',
      round: roundConfig.round,
      roundName: roundConfig.name,
      matches
    }
  })
}

function playerKey(playerId) {
  return String(playerId == null ? '' : playerId)
}

function createStandingRow(slot, groupCode, originalIndex) {
  return {
    playerId: slot && (slot.playerId || slot.id),
    playerName: (slot && (slot.playerName || slot.name)) || '',
    registrationId: (slot && (slot.registrationId || slot._id)) || null,
    groupCode,
    wins: 0,
    losses: 0,
    gameDiff: 0,
    totalGamesWon: 0,
    headToHead: '',
    rank: 0,
    source: '',
    promoted: false,
    __originalIndex: originalIndex
  }
}

function publicStandingRow(row) {
  const { __originalIndex, ...publicRow } = row
  return publicRow
}

function resultParticipantId(result, side) {
  const player = result && result[side]
  return (player && (player.id || player.playerId || player._id)) ||
    (result && (result[`${side}Id`] || result[`${side}PlayerId`]))
}

function firstSetScore(result) {
  const sets = result && result.score && result.score.sets
  const firstSet = Array.isArray(sets) ? sets[0] : null
  if (!firstSet) return null

  const a = Number(firstSet.a)
  const b = Number(firstSet.b)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return { a, b }
}

function confirmedGroupResults(results, groupCode) {
  return (Array.isArray(results) ? results : []).filter(result => (
    result &&
    result.resultStatus === 'confirmed' &&
    (result.stage == null || result.stage === 'group') &&
    (result.matchKind == null || result.matchKind === 'group') &&
    result.groupCode === groupCode
  ))
}

function headToHeadKey(playerId1, playerId2) {
  return [playerKey(playerId1), playerKey(playerId2)].sort().join('::')
}

function explicitWinnerId(result) {
  const winner = result && result.winner
  return (winner && (winner.id || winner.playerId || winner._id)) ||
    (result && (result.winnerId || result.winnerPlayerId))
}

function parseTiebreakScore(tiebreak) {
  if (!tiebreak) return null

  if (typeof tiebreak === 'string') {
    const match = tiebreak.trim().match(/^(\d+)\s*-\s*(\d+)$/)
    if (!match) return null
    return { a: Number(match[1]), b: Number(match[2]) }
  }

  return { a: Number(tiebreak.a), b: Number(tiebreak.b) }
}

function tiebreakWinnerRow(result, player1Row, player2Row) {
  const tiebreak = result && result.score && result.score.tiebreak
  const score = parseTiebreakScore(tiebreak)
  if (!score) return null

  const { a, b } = score
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null
  return a > b ? player1Row : player2Row
}

function winnerRowForResult(result, player1Row, player2Row, score) {
  if (score.a > score.b) return player1Row
  if (score.b > score.a) return player2Row

  const winnerId = explicitWinnerId(result)
  if (playerKey(winnerId) === playerKey(player1Row.playerId)) return player1Row
  if (playerKey(winnerId) === playerKey(player2Row.playerId)) return player2Row

  return tiebreakWinnerRow(result, player1Row, player2Row)
}

function applyResultToRows(result, rowsByPlayerId, headToHeadResults) {
  const player1Id = resultParticipantId(result, 'player1')
  const player2Id = resultParticipantId(result, 'player2')
  const player1Row = rowsByPlayerId.get(playerKey(player1Id))
  const player2Row = rowsByPlayerId.get(playerKey(player2Id))
  const score = firstSetScore(result)

  if (!player1Row || !player2Row || !score) return
  const winnerRow = winnerRowForResult(result, player1Row, player2Row, score)
  if (!winnerRow) return

  player1Row.totalGamesWon += score.a
  player2Row.totalGamesWon += score.b
  player1Row.gameDiff += score.a - score.b
  player2Row.gameDiff += score.b - score.a

  const loserRow = winnerRow === player1Row ? player2Row : player1Row
  winnerRow.wins += 1
  loserRow.losses += 1

  const key = headToHeadKey(player1Row.playerId, player2Row.playerId)
  if (!headToHeadResults.has(key)) {
    headToHeadResults.set(key, {
      winnerId: winnerRow.playerId,
      loserId: loserRow.playerId
    })
  }
}

function bucketRowsByMetric(rows, metric) {
  const bucketsByValue = new Map()
  for (const row of rows) {
    const value = row[metric]
    if (!bucketsByValue.has(value)) bucketsByValue.set(value, [])
    bucketsByValue.get(value).push(row)
  }

  return Array.from(bucketsByValue.entries())
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([, bucketRows]) => bucketRows)
}

function orderByMetrics(rows, metrics) {
  let buckets = [rows.slice()]

  for (const metric of metrics) {
    const nextBuckets = []
    for (const bucket of buckets) {
      if (bucket.length <= 1) {
        nextBuckets.push(bucket)
        continue
      }
      nextBuckets.push(...bucketRowsByMetric(bucket, metric))
    }
    buckets = nextBuckets
  }

  let unresolved = false
  const ordered = []
  for (const bucket of buckets) {
    if (bucket.length > 1) unresolved = true
    ordered.push(...bucket.slice().sort((a, b) => a.__originalIndex - b.__originalIndex))
  }

  return { ordered, unresolved }
}

function orderTwoPlayerTieByHeadToHead(rows, headToHeadResults) {
  const result = headToHeadResults.get(headToHeadKey(rows[0].playerId, rows[1].playerId))
  if (!result) return null

  const winnerRow = rows.find(row => playerKey(row.playerId) === playerKey(result.winnerId))
  const loserRow = rows.find(row => playerKey(row.playerId) === playerKey(result.loserId))
  if (!winnerRow || !loserRow) return null

  winnerRow.headToHead = `beat ${loserRow.playerId}`
  loserRow.headToHead = `lost to ${winnerRow.playerId}`
  return [winnerRow, loserRow]
}

function rankRows(rows, headToHeadResults) {
  const winBuckets = bucketRowsByMetric(rows, 'wins')
  const ordered = []
  let manualTiebreakRequired = false

  for (const bucket of winBuckets) {
    if (bucket.length === 1) {
      ordered.push(bucket[0])
      continue
    }

    if (bucket.length === 2) {
      const headToHeadOrder = orderTwoPlayerTieByHeadToHead(bucket, headToHeadResults)
      if (headToHeadOrder) {
        ordered.push(...headToHeadOrder)
        continue
      }
    }

    const metricOrder = orderByMetrics(bucket, ['gameDiff', 'totalGamesWon'])
    ordered.push(...metricOrder.ordered)
    manualTiebreakRequired = manualTiebreakRequired || metricOrder.unresolved
  }

  return { ordered, manualTiebreakRequired }
}

function assignRanksAndPromotion(rows, groupCode) {
  return rows.map((row, index) => publicStandingRow({
    ...row,
    rank: index + 1,
    source: index < 2 ? `${groupCode}${index + 1}` : '',
    promoted: index < 2
  }))
}

function orderRowsByManualOverride(rows, manualOverride) {
  const rowsByPlayerId = new Map(rows.map(row => [playerKey(row.playerId), row]))
  const usedPlayerIds = new Set()
  const ordered = []

  for (const overrideRow of manualOverride.finalRows) {
    const overridePlayerId = overrideRow && (overrideRow.playerId || overrideRow.id)
    const row = rowsByPlayerId.get(playerKey(overridePlayerId))
    if (!row || usedPlayerIds.has(playerKey(row.playerId))) continue

    ordered.push(row)
    usedPlayerIds.add(playerKey(row.playerId))
  }

  for (const row of rows) {
    if (usedPlayerIds.has(playerKey(row.playerId))) continue
    ordered.push(row)
  }

  return ordered
}

function validateManualOverride(rows, manualOverride) {
  if (!manualOverride || !Array.isArray(manualOverride.finalRows)) {
    return { valid: false, error: 'manualOverride.finalRows must be a complete duplicate-free permutation of group playerIds' }
  }

  const expectedIds = new Set(rows.map(row => playerKey(row.playerId)))
  const seenIds = new Set()

  if (manualOverride.finalRows.length !== rows.length) {
    return { valid: false, error: 'manualOverride.finalRows must include every group player exactly once' }
  }

  for (const overrideRow of manualOverride.finalRows) {
    const overridePlayerId = overrideRow && (overrideRow.playerId || overrideRow.id)
    const key = playerKey(overridePlayerId)
    if (!expectedIds.has(key)) {
      return { valid: false, error: `manualOverride.finalRows contains unknown playerId ${overridePlayerId || ''}` }
    }
    if (seenIds.has(key)) {
      return { valid: false, error: `manualOverride.finalRows contains duplicate playerId ${overridePlayerId}` }
    }
    seenIds.add(key)
  }

  return { valid: true, error: '' }
}

function calculateGroupStandings({ groups, results, manualOverrides } = {}) {
  const standings = {}

  for (const group of Array.isArray(groups) ? groups : []) {
    const groupCode = group && group.groupCode
    const rows = (Array.isArray(group && group.slots) ? group.slots : [])
      .slice()
      .sort((a, b) => (a.slotNo || 0) - (b.slotNo || 0))
      .map((slot, index) => createStandingRow(slot, groupCode, index))
    const rowsByPlayerId = new Map(rows.map(row => [playerKey(row.playerId), row]))
    const headToHeadResults = new Map()

    for (const result of confirmedGroupResults(results, groupCode)) {
      applyResultToRows(result, rowsByPlayerId, headToHeadResults)
    }

    const manualOverride = manualOverrides && manualOverrides[groupCode]
    const ranked = rankRows(rows, headToHeadResults)

    if (manualOverride) {
      const overrideValidation = validateManualOverride(rows, manualOverride)
      if (!overrideValidation.valid) {
        standings[groupCode] = {
          groupCode,
          rows: assignRanksAndPromotion(ranked.ordered, groupCode),
          manualTiebreakRequired: ranked.manualTiebreakRequired,
          overrideError: overrideValidation.error
        }
        continue
      }

      standings[groupCode] = {
        groupCode,
        rows: assignRanksAndPromotion(orderRowsByManualOverride(rows, manualOverride), groupCode),
        manualTiebreakRequired: false,
        manualOverride
      }
      continue
    }

    standings[groupCode] = {
      groupCode,
      rows: assignRanksAndPromotion(ranked.ordered, groupCode),
      manualTiebreakRequired: ranked.manualTiebreakRequired
    }
  }

  return standings
}

module.exports = {
  GROUP_CODES,
  GROUP_KNOCKOUT_PHASES,
  SUPPORTED_BRACKET_SIZES,
  defaultGroupKnockoutPoints,
  expectedGroupSize,
  validateGroupAssignments,
  generateGroupMatches,
  generateKnockoutMatches,
  groupBracketDocId,
  knockoutBracketDocId,
  calculateGroupStandings,
  normalizeTournamentId,
  clone,
  regToPlayer
}
