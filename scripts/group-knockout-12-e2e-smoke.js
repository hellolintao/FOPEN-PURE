#!/usr/bin/env node

const tcb = require('@cloudbase/node-sdk')
const {
  GROUP_CODES,
  generateGroupMatches,
  generateKnockoutMatches,
  calculateGroupStandings,
  groupBracketDocId,
  knockoutBracketDocId,
  normalizeTournamentId,
} = require('../cloudfunctions/tournament-brackets/lib/group-knockout')

const BRACKET_SIZE = 12
const SEASON_ID = process.env.SEASON_ID || 'season_2026'
const START_DATE = process.env.GK12_START_DATE || '2026-06-30'

const POINT_RULES_12 = {
  winLoss: { win: 0, loss: 0, walkover: 0 },
  placement: { champion: 250, runnerUp: 150, semifinal: 100, quarterfinal: 65, participation: 0 },
  groupKnockout: {
    12: {
      placement: { champion: 250, runnerUp: 150, semifinal: 100, quarterfinal: 65 },
      group: { win: 20, loss: 10 }
    }
  }
}

function requireCloudEnv() {
  const env = process.env.FOPEN_CLOUD_ENV
  if (!env) throw new Error('FOPEN_CLOUD_ENV is required')
  return env
}

async function main() {
  const env = requireCloudEnv()
  const app = tcb.init({ env })
  const db = app.database()
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const tournamentId = `tournament_gk12_${stamp}`
  const tournamentName = `GK12_E2E_${stamp}`
  const now = new Date()

  const players = await selectPlayers(db)
  const courts = await selectCourts(db)
  const schedulePlan = buildSchedulePlan(courts)
  const groups = buildGroups(players, tournamentId)

  await createTournament(app, tournamentId, tournamentName, schedulePlan)
  await writeRegistrations(db, tournamentId, players, now)
  await writeGroups(db, tournamentId, groups, now)

  const groupMatches = await publishGroupStage(db, tournamentId, groups, now)
  const groupResults = await confirmGroupStage(db, tournamentId, groupMatches, now)
  const standings = calculateGroupStandings({ groups, results: groupResults })
  const seeds = buildSeedsFromStandings(standings)
  assertSeedPairings(seeds)

  const knockoutBrackets = await publishKnockoutStage(db, tournamentId, seeds, now)
  const knockoutResults = await completeKnockoutStage(db, tournamentId, knockoutBrackets, now)

  await updateTournament(db, tournamentId, {
    status: 'completed',
    completedAt: now,
    updateTime: now,
  })

  const recompute = await app.callFunction({
    name: 'points-engine',
    data: { action: 'recompute', tournamentId }
  })
  assertCloudSuccess(recompute, 'points-engine.recompute')

  const bracketRead = await app.callFunction({
    name: 'tournament-brackets',
    data: { action: 'getGroupKnockoutBracket', tournamentId }
  })
  const bracketData = assertCloudSuccess(bracketRead, 'tournament-brackets.getGroupKnockoutBracket').data
  const verification = await verifyFinalState(db, tournamentId, {
    players,
    groups,
    seeds,
    groupMatches,
    groupResults,
    knockoutResults,
    bracketData,
  })

  console.log(JSON.stringify({
    ok: true,
    env,
    tournamentId,
    tournamentName,
    startDate: START_DATE,
    players: players.map((player, index) => ({
      seed: index + 1,
      id: player.id,
      name: player.name,
    })),
    groups: groups.map(group => ({
      groupCode: group.groupCode,
      slots: group.slots.map(slot => `${slot.slotNo}.${slot.playerName}`)
    })),
    expectedQuarterfinals: [
      'A1 vs B2',
      'B1 vs A2',
      'C1 vs D2',
      'D1 vs C2',
    ],
    champion: verification.champion,
    points: verification.pointsByName,
    counts: verification.counts,
  }, null, 2))
}

async function selectPlayers(db) {
  const res = await db.collection('members').limit(200).get()
  const rows = (res.data || [])
    .map(memberToPlayer)
    .filter(player => player.id && player.name)
  const unique = []
  const seen = new Set()
  for (const player of rows) {
    if (seen.has(player.id)) continue
    seen.add(player.id)
    unique.push(player)
  }
  if (unique.length < BRACKET_SIZE) {
    throw new Error(`Need at least ${BRACKET_SIZE} members, got ${unique.length}`)
  }
  return unique.slice(0, BRACKET_SIZE)
}

function memberToPlayer(member) {
  return {
    id: member._id || member.id || member.memberId || '',
    name: member.name || member.nickName || member.nickname || member.displayName || member.playerName || '',
  }
}

async function selectCourts(db) {
  const res = await db.collection('courts').limit(8).get()
  const courts = (res.data || []).map((court, index) => ({
    courtId: court._id || court.courtId || `court_${index + 1}`,
    name: court.name || court.courtName || court.title || `球场${index + 1}`,
  }))
  if (courts.length === 0) {
    return [{ courtId: 'gk12_court_1', name: '测试球场' }]
  }
  return courts.slice(0, 4)
}

function buildSchedulePlan(courts) {
  const slots = ['21:00', '22:00', '23:00']
  return {
    slotMinutes: 20,
    courts: courts.map(court => ({
      courtId: court.courtId,
      name: court.name,
      slots: slots.map(time => `${START_DATE}T${time}:00+08:00`)
    })),
    queues: [],
    freePlays: [],
  }
}

async function createTournament(app, tournamentId, tournamentName, schedulePlan) {
  const payload = {
    _id: tournamentId,
    seasonId: SEASON_ID,
    name: tournamentName,
    type: 'singles',
    format: 'group_knockout',
    startDate: START_DATE,
    endDate: START_DATE,
    location: '海峡奥体网球场',
    status: 'upcoming',
    scheduleStatus: 'none',
    schedulePlan,
    bracketSize: BRACKET_SIZE,
    maxPlayers: BRACKET_SIZE,
    groupDrawMode: 'onsite',
    groupKnockoutPhase: 'group_draft',
    pointsRules: POINT_RULES_12,
  }
  const res = await app.callFunction({ name: 'tournaments', data: { action: 'create', data: payload } })
  assertCloudSuccess(res, 'tournaments.create')
}

async function writeRegistrations(db, tournamentId, players, now) {
  const prefix = normalizeTournamentId(tournamentId)
  for (let index = 0; index < players.length; index += 1) {
    const player = players[index]
    const docId = `reg_${prefix}_${String(index + 1).padStart(3, '0')}`
    await setDoc(db, 'tournament_registrations', docId, {
      tournamentId,
      seasonId: SEASON_ID,
      type: 'singles',
      playerId: player.id,
      playerName: player.name,
      partnerId: null,
      partnerName: null,
      teamName: null,
      seed: index + 1,
      registrationStatus: 'confirmed',
      createTime: now,
      updateTime: now,
    })
  }
}

function buildGroups(players, tournamentId) {
  const prefix = normalizeTournamentId(tournamentId)
  return GROUP_CODES.map((groupCode, groupIndex) => ({
    groupCode,
    slots: [1, 2, 3].map(slotNo => {
      const player = players[groupIndex * 3 + slotNo - 1]
      const playerIndex = groupIndex * 3 + slotNo
      return {
        slotNo,
        playerId: player.id,
        playerName: player.name,
        registrationId: `reg_${prefix}_${String(playerIndex).padStart(3, '0')}`,
      }
    })
  }))
}

async function writeGroups(db, tournamentId, groups, now) {
  for (const group of groups) {
    await setDoc(db, 'tournament_groups', `group_${tournamentId}_${group.groupCode}`, {
      tournamentId,
      groupCode: group.groupCode,
      slots: group.slots,
      createTime: now,
      updateTime: now,
    })
  }
}

async function publishGroupStage(db, tournamentId, groups, now) {
  const matches = generateGroupMatches({ tournamentId, bracketSize: BRACKET_SIZE, groups, now: now.getTime() })
  for (const groupCode of GROUP_CODES) {
    const groupMatches = matches.filter(match => match.groupCode === groupCode)
    await setDoc(db, 'tournament_brackets', groupBracketDocId(tournamentId, groupCode), {
      tournamentId,
      format: 'group_knockout',
      stage: 'group',
      groupCode,
      round: 1,
      type: 'singles',
      matches: groupMatches,
      createTime: now,
      updateTime: now,
    })
  }
  for (const match of matches) {
    await setDoc(db, 'match_results', resultIdFor(tournamentId, match.matchId), resultRowFromMatch(tournamentId, match, now))
  }
  await updateTournament(db, tournamentId, {
    status: 'ongoing',
    groupKnockoutPhase: 'group_published',
    updateTime: now,
  })
  return matches
}

async function confirmGroupStage(db, tournamentId, matches, now) {
  const results = []
  for (const match of matches) {
    const winner = match.groupSlot1 < match.groupSlot2 ? match.player1 : match.player2
    const score = match.groupSlot1 < match.groupSlot2
      ? { sets: [{ a: 4, b: match.groupSlot2 === 2 ? 1 : 0 }], tiebreak: null }
      : { sets: [{ a: 4, b: 2 }], tiebreak: null }
    const row = {
      ...resultRowFromMatch(tournamentId, match, now),
      score,
      status: 'completed',
      resultStatus: 'confirmed',
      winner,
      winnerId: winner.id,
      confirmedBy: 'codex-e2e',
      confirmedAt: now,
      updateTime: now,
    }
    await setDoc(db, 'match_results', row._id, stripId(row))
    results.push(row)
  }
  await updateTournament(db, tournamentId, {
    groupKnockoutPhase: 'group_completed',
    updateTime: now,
  })
  return results
}

function buildSeedsFromStandings(standings) {
  const seeds = {}
  for (const groupCode of GROUP_CODES) {
    const rows = standings[groupCode] && standings[groupCode].rows
    if (!Array.isArray(rows)) throw new Error(`Missing standings for group ${groupCode}`)
    for (const row of rows.filter(item => item.rank === 1 || item.rank === 2)) {
      seeds[`${groupCode}${row.rank}`] = {
        id: row.playerId,
        name: row.playerName,
        registrationId: row.registrationId || null,
      }
    }
  }
  return seeds
}

function assertSeedPairings(seeds) {
  const required = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2']
  const missing = required.filter(key => !seeds[key])
  if (missing.length) throw new Error(`Missing knockout seeds: ${missing.join(', ')}`)
}

async function publishKnockoutStage(db, tournamentId, seeds, now) {
  const brackets = generateKnockoutMatches({ tournamentId, seeds, now: now.getTime() })
  for (const bracket of brackets) {
    await setDoc(db, 'tournament_brackets', bracket._id, {
      ...stripId(bracket),
      createTime: now,
      updateTime: now,
    })
    for (const match of bracket.matches) {
      await setDoc(db, 'match_results', resultIdFor(tournamentId, match.matchId), resultRowFromMatch(tournamentId, match, now))
    }
  }
  await updateTournament(db, tournamentId, {
    groupKnockoutPhase: 'knockout_published',
    updateTime: now,
  })
  return brackets
}

async function completeKnockoutStage(db, tournamentId, brackets, now) {
  const byRound = new Map(brackets.map(bracket => [bracket.round, bracket]))
  const results = []
  const winnerPlan = {
    '1-1': 'player1',
    '1-2': 'player1',
    '1-3': 'player1',
    '1-4': 'player1',
    '2-1': 'player1',
    '2-2': 'player1',
    '3-1': 'player1',
  }

  for (const round of [1, 2, 3]) {
    const bracket = byRound.get(round)
    for (const match of bracket.matches) {
      const side = winnerPlan[`${round}-${match.position}`]
      const winner = match[side]
      if (!winner || !winner.id) throw new Error(`Missing winner side for R${round}P${match.position}`)
      const row = await confirmKnockoutMatch(db, tournamentId, byRound, match, winner, now)
      results.push(row)
    }
  }
  return results
}

async function confirmKnockoutMatch(db, tournamentId, byRound, match, winner, now) {
  const row = {
    ...resultRowFromMatch(tournamentId, match, now),
    score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
    status: 'completed',
    resultStatus: 'confirmed',
    winner,
    winnerId: winner.id,
    confirmedBy: 'codex-e2e',
    confirmedAt: now,
    updateTime: now,
  }
  await setDoc(db, 'match_results', row._id, stripId(row))

  const currentBracket = byRound.get(match.round)
  const currentIndex = currentBracket.matches.findIndex(item => item.position === match.position)
  currentBracket.matches[currentIndex] = {
    ...currentBracket.matches[currentIndex],
    winner,
    status: 'confirmed',
    resultStatus: 'confirmed',
  }
  await setDoc(db, 'tournament_brackets', currentBracket._id, {
    ...stripId(currentBracket),
    updateTime: now,
  })

  if (match.round < 3) {
    const nextBracket = byRound.get(match.round + 1)
    const nextPosition = Math.ceil(match.position / 2)
    const nextIndex = nextBracket.matches.findIndex(item => item.position === nextPosition)
    const slot = match.position % 2 === 1 ? 'player1' : 'player2'
    nextBracket.matches[nextIndex] = {
      ...nextBracket.matches[nextIndex],
      [slot]: winner,
    }
    await setDoc(db, 'tournament_brackets', nextBracket._id, {
      ...stripId(nextBracket),
      updateTime: now,
    })

    const nextMatch = nextBracket.matches[nextIndex]
    const nextResultId = resultIdFor(tournamentId, nextMatch.matchId)
    const nextRow = {
      ...resultRowFromMatch(tournamentId, nextMatch, now),
      updateTime: now,
    }
    await setDoc(db, 'match_results', nextResultId, stripId(nextRow))
  }

  return row
}

function resultRowFromMatch(tournamentId, match, now) {
  const row = {
    _id: resultIdFor(tournamentId, match.matchId),
    tournamentId,
    seasonId: SEASON_ID,
    tournamentType: 'singles',
    type: 'singles',
    format: 'group_knockout',
    stage: match.stage,
    matchKind: match.matchKind,
    sourceMatchId: match.matchId,
    round: match.round,
    position: match.position,
    player1: match.player1 || null,
    player2: match.player2 || null,
    playerIds: collectPlayerIds(match),
    courtId: match.courtId || null,
    queueOrder: match.queueOrder || null,
    score: null,
    status: 'pending',
    resultStatus: 'pending',
    winner: null,
    winnerId: null,
    pointsAwarded: null,
    createTime: now,
    updateTime: now,
  }
  if (match.groupCode) row.groupCode = match.groupCode
  if (match.groupSlot1) row.groupSlot1 = match.groupSlot1
  if (match.groupSlot2) row.groupSlot2 = match.groupSlot2
  return row
}

function collectPlayerIds(match) {
  return [match.player1 && match.player1.id, match.player2 && match.player2.id].filter(Boolean)
}

function resultIdFor(tournamentId, matchId) {
  return `result_${normalizeTournamentId(tournamentId)}_${matchId}`
}

async function verifyFinalState(db, tournamentId, context) {
  const tournament = (await db.collection('tournaments').doc(tournamentId).get()).data
  if (!tournament) throw new Error('Tournament missing after smoke')
  if (tournament.status !== 'completed') throw new Error(`Expected tournament completed, got ${tournament.status}`)
  if (tournament.groupKnockoutPhase !== 'completed') {
    throw new Error(`Expected groupKnockoutPhase completed, got ${tournament.groupKnockoutPhase}`)
  }

  const brackets = await fetchAll(db, 'tournament_brackets', { tournamentId })
  const rows = await fetchAll(db, 'match_results', { tournamentId })
  const groups = await fetchAll(db, 'tournament_groups', { tournamentId })
  const activeRows = rows.filter(row => !row.archivedAt)
  const confirmedRows = activeRows.filter(row => row.resultStatus === 'confirmed')

  if (groups.length !== 4) throw new Error(`Expected 4 groups, got ${groups.length}`)
  if (brackets.filter(bracket => bracket.stage === 'group').length !== 4) throw new Error('Expected 4 group brackets')
  if (brackets.filter(bracket => bracket.stage === 'knockout').length !== 3) throw new Error('Expected 3 knockout brackets')
  if (activeRows.length !== 19) throw new Error(`Expected 19 match rows, got ${activeRows.length}`)
  if (confirmedRows.length !== 19) throw new Error(`Expected 19 confirmed rows, got ${confirmedRows.length}`)

  const round1 = brackets.find(bracket => bracket._id === knockoutBracketDocId(tournamentId, 1))
  const round2 = brackets.find(bracket => bracket._id === knockoutBracketDocId(tournamentId, 2))
  const round3 = brackets.find(bracket => bracket._id === knockoutBracketDocId(tournamentId, 3))
  const sourcePairs = round1.matches.map(match => [match.player1Source, match.player2Source].join('-'))
  assertDeepEqual(sourcePairs, ['A1-B2', 'B1-A2', 'C1-D2', 'D1-C2'], 'quarterfinal source labels')
  if (round2.matches.some(match => match.player1Source || match.player2Source) ||
      round3.matches.some(match => match.player1Source || match.player2Source)) {
    throw new Error('Source labels should only exist on quarterfinal matches')
  }

  const final = round3.matches[0]
  const champion = final.winner
  if (!champion || champion.id !== context.seeds.A1.id) {
    throw new Error(`Expected champion A1 ${context.seeds.A1.id}, got ${champion && champion.id}`)
  }

  const pointsByMember = aggregatePoints(activeRows)
  const expectedPoints = expectedPointMap(context.seeds, context.groups)
  for (const [memberId, points] of expectedPoints.entries()) {
    const actual = pointsByMember.get(memberId) || 0
    if (actual !== points) {
      throw new Error(`Expected points ${points} for ${memberId}, got ${actual}`)
    }
  }

  if (!context.bracketData || !Array.isArray(context.bracketData.groupBrackets) || !Array.isArray(context.bracketData.knockoutBrackets)) {
    throw new Error('getGroupKnockoutBracket did not return bracket arrays')
  }

  return {
    champion: champion.name,
    pointsByName: Object.fromEntries(
      [...expectedPoints.entries()].map(([memberId]) => {
        const player = context.players.find(item => item.id === memberId)
        return [player ? player.name : memberId, pointsByMember.get(memberId) || 0]
      })
    ),
    counts: {
      groups: groups.length,
      groupBrackets: brackets.filter(bracket => bracket.stage === 'group').length,
      knockoutBrackets: brackets.filter(bracket => bracket.stage === 'knockout').length,
      matchRows: activeRows.length,
      confirmedRows: confirmedRows.length,
    },
  }
}

function expectedPointMap(seeds, groups) {
  const map = new Map()
  map.set(seeds.A1.id, 250)
  map.set(seeds.C1.id, 150)
  map.set(seeds.B1.id, 100)
  map.set(seeds.D1.id, 100)
  for (const key of ['C2', 'D2', 'A2', 'B2']) map.set(seeds[key].id, 65)
  for (const group of groups) {
    const slot3 = group.slots.find(slot => slot.slotNo === 3)
    map.set(slot3.playerId, 20)
  }
  return map
}

function aggregatePoints(rows) {
  const map = new Map()
  for (const row of rows) {
    for (const entry of (row.pointsAwarded && row.pointsAwarded.entries) || []) {
      const current = map.get(entry.memberId) || 0
      map.set(entry.memberId, current + (entry.points || 0))
    }
  }
  return map
}

async function fetchAll(db, collection, where) {
  const res = await db.collection(collection).where(where).limit(500).get()
  return res.data || []
}

async function updateTournament(db, tournamentId, patch) {
  await db.collection('tournaments').doc(tournamentId).update(patch)
}

async function setDoc(db, collection, id, data) {
  await db.collection(collection).doc(id).set(data)
}

function stripId(doc) {
  const { _id, ...rest } = doc
  return rest
}

function assertCloudSuccess(res, label) {
  const result = res && Object.prototype.hasOwnProperty.call(res, 'result') ? res.result : res
  if (!result || result.success !== true) {
    throw new Error(`${label} failed: ${JSON.stringify(result && result.error ? result.error : result)}`)
  }
  return result
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[abort] ${err.message}`)
    process.exit(1)
  })
}
