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
  normalizeTournamentId,
  clone,
  regToPlayer
}
