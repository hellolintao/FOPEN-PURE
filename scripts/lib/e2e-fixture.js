const SCORE_A_BEATS_B_4_2 = deepFreeze({ sets: [{ a: 4, b: 2 }], tiebreak: null })
const SCORE_B_WINS_TIEBREAK = deepFreeze({ sets: [{ a: 3, b: 3 }], tiebreak: '5-7' })
const POINTS_RULES = deepFreeze({
  winLoss: { win: 20, loss: 10, walkover: 0 },
  placement: { champion: 100, runnerUp: 60, semifinal: 30, quarterfinal: 10, participation: 5 },
})
const DEFAULT_FIXTURE_NOW = deepFreeze(new Date('2026-05-17T10:00:00.000Z'))

function selectActors({ members = [], courts = [] } = {}) {
  const adminMember = members.find(m => isAdminMember(m) && hasLoginOpenid(m))
  const players = members.filter(m => m && !isAdminMember(m) && hasLoginOpenid(m)).slice(0, 5)
  const enabledCourts = courts.filter(c => c && c.enabled === true).slice(0, 2)

  if (!adminMember) throw new Error('Fixture requires one admin member with openid/openId')
  if (players.length < 5) throw new Error('Fixture requires five normal members with openid/openId')
  if (enabledCourts.length < 2) throw new Error('Fixture requires two enabled courts')

  return { adminMember, players, courts: enabledCourts }
}

function buildE2EFixture({ actors, seasonId, now = DEFAULT_FIXTURE_NOW }) {
  if (!actors) throw new Error('Fixture requires selected actors')
  if (!seasonId) throw new Error('Fixture requires a seasonId')

  const selected = normalizeActors(actors)
  const [A, B, C, D, E] = selected.players
  const admin = selected.adminMember
  const [court1, court2] = selected.courts
  const seedTime = new Date(now)
  const stamp = timestampKey(seedTime)
  const ids = {
    regularSinglesTournamentId: `e2e_regular_singles_${stamp}`,
    knockoutSinglesTournamentId: `e2e_knockout_singles_${stamp}`,
    doublesTournamentId: `e2e_regular_doubles_${stamp}`,
    interactiveTournamentId: `e2e_interactive_${stamp}`,
  }

  const schedulePlans = {
    regularSingles: schedulePlan(selected.courts, seedTime, [
      [queueItem('rs_m1', 0)],
      [queueItem('rs_m2', 0)],
    ]),
    knockoutSingles: schedulePlan(selected.courts, seedTime, [
      [queueItem('ko_r1_m1', 0)],
      [queueItem('ko_r1_m2', 0)],
    ]),
    doubles: schedulePlan(selected.courts, seedTime, [
      [queueItem('db_m1', 0)],
      [],
    ]),
    interactive: schedulePlan(selected.courts, seedTime, [
      [queueItem('int_pending', 0)],
      [queueItem('int_submitted', 0)],
    ]),
  }

  const tournaments = [
    tournamentDoc(ids.regularSinglesTournamentId, `E2E_Regular_Singles_${stamp}`, 'singles', 'regular', seasonId, 'completed', schedulePlans.regularSingles, seedTime),
    tournamentDoc(ids.knockoutSinglesTournamentId, `E2E_Knockout_Singles_${stamp}`, 'singles', 'knockout', seasonId, 'completed', schedulePlans.knockoutSingles, seedTime),
    tournamentDoc(ids.doublesTournamentId, `E2E_Regular_Doubles_${stamp}`, 'doubles', 'regular', seasonId, 'completed', schedulePlans.doubles, seedTime),
    tournamentDoc(ids.interactiveTournamentId, `E2E_Interactive_${stamp}`, 'singles', 'regular', seasonId, 'ongoing', schedulePlans.interactive, seedTime),
  ]

  const match_results = [
    confirmedSingles(ids.regularSinglesTournamentId, 'rs_m1', 1, 1, A, B, SCORE_A_BEATS_B_4_2, A, seedTime, seasonId, 'regularRound', courtAssignment(court1, 0)),
    confirmedSingles(ids.regularSinglesTournamentId, 'rs_m2', 1, 2, C, D, SCORE_B_WINS_TIEBREAK, D, seedTime, seasonId, 'regularRound', courtAssignment(court2, 0)),
    confirmedSingles(ids.knockoutSinglesTournamentId, 'ko_r1_m1', 1, 1, A, B, { sets: [{ a: 4, b: 0 }], tiebreak: null }, A, seedTime, seasonId, 'bracket', courtAssignment(court1, 0)),
    confirmedSingles(ids.knockoutSinglesTournamentId, 'ko_r1_m2', 1, 2, C, D, { sets: [{ a: 4, b: 1 }], tiebreak: null }, C, seedTime, seasonId, 'bracket', courtAssignment(court2, 0)),
    confirmedSingles(ids.knockoutSinglesTournamentId, 'ko_f_m1', 2, 1, A, C, SCORE_A_BEATS_B_4_2, A, seedTime, seasonId, 'bracket'),
    confirmedDoubles(ids.doublesTournamentId, 'db_m1', A, B, C, D, SCORE_A_BEATS_B_4_2, seedTime, seasonId, courtAssignment(court1, 0)),
    pendingSingles(ids.interactiveTournamentId, 'int_pending', 1, 1, admin, A, seedTime, seasonId, courtAssignment(court1, 0)),
    submittedSingles(ids.interactiveTournamentId, 'int_submitted', 1, 2, B, C, SCORE_A_BEATS_B_4_2, seedTime, seasonId, courtAssignment(court2, 0)),
  ]

  const tournament_points = [
    placement(ids.knockoutSinglesTournamentId, A, seasonId, 'singles', 'champion', POINTS_RULES.placement.champion, seedTime),
    placement(ids.knockoutSinglesTournamentId, C, seasonId, 'singles', 'runnerUp', POINTS_RULES.placement.runnerUp, seedTime),
    placement(ids.knockoutSinglesTournamentId, B, seasonId, 'singles', 'semifinal', POINTS_RULES.placement.semifinal, seedTime),
    placement(ids.knockoutSinglesTournamentId, D, seasonId, 'singles', 'semifinal', POINTS_RULES.placement.semifinal, seedTime),
  ]

  return {
    ids,
    actors: { adminMember: admin, players: [A, B, C, D, E], courts: [court1, court2] },
    collections: {
      tournaments,
      tournament_brackets: [
        bracket(ids.regularSinglesTournamentId, 1, 'singles', [
          bracketMatch('rs_m1', 1, 1, A, B, A, 'confirmed', courtAssignment(court1, 0), 'regularRound'),
          bracketMatch('rs_m2', 1, 2, C, D, D, 'confirmed', courtAssignment(court2, 0), 'regularRound'),
        ]),
        bracket(ids.knockoutSinglesTournamentId, 1, 'singles', [
          bracketMatch('ko_r1_m1', 1, 1, A, B, A, 'confirmed', courtAssignment(court1, 0)),
          bracketMatch('ko_r1_m2', 1, 2, C, D, C, 'confirmed', courtAssignment(court2, 0)),
        ]),
        bracket(ids.knockoutSinglesTournamentId, 2, 'singles', [
          bracketMatch('ko_f_m1', 2, 1, A, C, A, 'confirmed'),
        ]),
        bracket(ids.doublesTournamentId, 1, 'doubles', [
          bracketMatch(
            'db_m1',
            1,
            1,
            { _id: A._id, name: A.name, partnerId: B._id, partnerName: B.name },
            { _id: C._id, name: C.name, partnerId: D._id, partnerName: D.name },
            { _id: A._id, name: A.name, partnerId: B._id, partnerName: B.name },
            'confirmed',
            courtAssignment(court1, 0),
            'regularRound'
          ),
        ]),
        bracket(ids.interactiveTournamentId, 1, 'singles', [
          bracketMatch('int_pending', 1, 1, admin, A, null, 'pending', courtAssignment(court1, 0), 'regularRound'),
          bracketMatch('int_submitted', 1, 2, B, C, null, 'submitted', courtAssignment(court2, 0), 'regularRound'),
        ]),
      ],
      tournament_registrations: [
        ...registrations(ids.regularSinglesTournamentId, [A, B, C, D], seasonId, 'singles', seedTime),
        ...registrations(ids.knockoutSinglesTournamentId, [A, B, C, D], seasonId, 'singles', seedTime),
        ...registrations(ids.doublesTournamentId, [A, B, C, D], seasonId, 'doubles', seedTime),
        ...registrations(ids.interactiveTournamentId, [admin, A, B, C], seasonId, 'singles', seedTime),
      ],
      match_results,
      tournament_points,
      free_plays: [],
      rank_snapshots: [],
      weekly_stars: [],
    },
  }
}

function isAdminMember(member) {
  return member && (member.admin === true || member.isAdmin === true)
}

function hasLoginOpenid(member) {
  return !!(member && (
    (typeof member.openid === 'string' && member.openid.trim()) ||
    (typeof member.openId === 'string' && member.openId.trim())
  ))
}

function normalizeActors(actors) {
  if (actors.adminMember || actors.players || actors.courts) {
    const selected = {
      adminMember: actors.adminMember,
      players: (actors.players || []).slice(0, 5),
      courts: (actors.courts || []).slice(0, 2),
    }
    if (!selected.adminMember || !hasLoginOpenid(selected.adminMember)) {
      throw new Error('Fixture requires one admin member with openid/openId')
    }
    if (selected.players.length < 5 || selected.players.some(player => !hasLoginOpenid(player))) {
      throw new Error('Fixture requires five normal members with openid/openId')
    }
    if (selected.courts.filter(c => c && c.enabled === true).length < 2) throw new Error('Fixture requires two enabled courts')
    return selected
  }
  return selectActors(actors)
}

function tournamentDoc(_id, name, type, format, seasonId, status, plan, now) {
  return { _id, name, type, format, seasonId, status, schedulePlan: plan, pointsRules: POINTS_RULES, createTime: now, updateTime: now }
}

function registrations(tournamentId, players, seasonId, type, now) {
  return players.map((p, index) => ({
    _id: `reg_${tournamentId}_${p._id}`,
    tournamentId,
    seasonId,
    type,
    playerId: p._id,
    playerName: p.name || p._id,
    partnerId: null,
    partnerName: null,
    teamName: '',
    seed: index + 1,
    status: 'confirmed',
    registrationStatus: 'confirmed',
    registerTime: now,
    createTime: now,
    updateTime: now,
  }))
}

function confirmedSingles(tournamentId, sourceMatchId, round, position, p1, p2, score, winner, now, seasonId, matchKind = 'regularRound', assignment = {}) {
  const loser = winner._id === p1._id ? p2 : p1
  return baseMatch({
    tournamentId,
    sourceMatchId,
    round,
    position,
    p1,
    p2,
    score,
    winner,
    now,
    seasonId,
    tournamentType: 'singles',
    matchKind,
    resultStatus: 'confirmed',
    pointsAwarded: awardEntries([winner], [loser]),
    ...assignment,
  })
}

function pendingSingles(tournamentId, sourceMatchId, round, position, p1, p2, now, seasonId, assignment = {}) {
  return baseMatch({
    tournamentId,
    sourceMatchId,
    round,
    position,
    p1,
    p2,
    score: null,
    winner: null,
    now,
    seasonId,
    tournamentType: 'singles',
    matchKind: 'regularRound',
    resultStatus: 'pending',
    pointsAwarded: null,
    ...assignment,
  })
}

function submittedSingles(tournamentId, sourceMatchId, round, position, p1, p2, score, now, seasonId, assignment = {}) {
  return baseMatch({
    tournamentId,
    sourceMatchId,
    round,
    position,
    p1,
    p2,
    score,
    winner: null,
    now,
    seasonId,
    tournamentType: 'singles',
    matchKind: 'regularRound',
    resultStatus: 'submitted',
    pointsAwarded: null,
    ...assignment,
  })
}

function confirmedDoubles(tournamentId, sourceMatchId, A, B, C, D, score, now, seasonId, assignment = {}) {
  return {
    ...baseMatch({
      tournamentId,
      sourceMatchId,
      round: 1,
      position: 1,
      p1: { _id: A._id, name: A.name, partnerId: B._id, partnerName: B.name },
      p2: { _id: C._id, name: C.name, partnerId: D._id, partnerName: D.name },
      score,
      winner: { _id: A._id, name: A.name, partnerId: B._id, partnerName: B.name },
      now,
      seasonId,
      tournamentType: 'doubles',
      matchKind: 'regularRound',
      resultStatus: 'confirmed',
      ...assignment,
      pointsAwarded: {
        source: 'match',
        entries: [
          { memberId: A._id, points: POINTS_RULES.winLoss.win, role: 'winner' },
          { memberId: B._id, points: POINTS_RULES.winLoss.win, role: 'winner' },
          { memberId: C._id, points: POINTS_RULES.winLoss.loss, role: 'loser' },
          { memberId: D._id, points: POINTS_RULES.winLoss.loss, role: 'loser' },
        ],
      },
    }),
    playerIds: [A._id, B._id, C._id, D._id],
  }
}

function baseMatch({
  tournamentId,
  sourceMatchId,
  round,
  position,
  p1,
  p2,
  score,
  winner,
  now,
  seasonId,
  tournamentType,
  matchKind,
  resultStatus,
  pointsAwarded,
  courtId = null,
  queueOrder = null,
}) {
  const player1 = toPlayerSide(p1)
  const player2 = toPlayerSide(p2)
  return {
    _id: `result_${tournamentId}_${sourceMatchId}`,
    tournamentId,
    seasonId,
    tournamentType,
    matchKind,
    sourceMatchId,
    round,
    position,
    player1,
    player2,
    playerIds: collectIds(player1, player2),
    courtId,
    queueOrder,
    score: cloneScore(score),
    resultStatus,
    winner: winner ? toPlayerSide(winner) : null,
    winnerId: winner ? winner._id : null,
    confirmedAt: resultStatus === 'confirmed' ? now : null,
    confirmedBy: resultStatus === 'confirmed' ? 'e2e_seed' : null,
    submittedAt: resultStatus === 'submitted' ? now : null,
    submittedBy: resultStatus === 'submitted' ? player1.id : null,
    pointsAwarded,
    createTime: now,
    updateTime: now,
  }
}

function toPlayerSide(player) {
  return {
    id: player._id,
    name: player.name || player._id,
    partnerId: player.partnerId || null,
    partnerName: player.partnerName || null,
  }
}

function collectIds(player1, player2) {
  return [player1.id, player1.partnerId, player2.id, player2.partnerId].filter(Boolean)
}

function awardEntries(winners, losers) {
  return {
    source: 'match',
    entries: [
      ...winners.map(p => ({ memberId: p._id, points: POINTS_RULES.winLoss.win, role: 'winner' })),
      ...losers.map(p => ({ memberId: p._id, points: POINTS_RULES.winLoss.loss, role: 'loser' })),
    ],
  }
}

function placement(tournamentId, member, seasonId, tournamentType, rank, points, now) {
  return {
    _id: `${tournamentId}_${member._id}_placement`,
    tournamentId,
    memberId: member._id,
    seasonId,
    tournamentType,
    points,
    rank,
    awardedAt: now,
    createTime: now,
    updateTime: now,
  }
}

function bracket(tournamentId, round, type, matches) {
  return { _id: `bracket_${tournamentId}_round_${round}`, tournamentId, round, type, matches }
}

function bracketMatch(matchId, round, position, p1, p2, winner, status, assignment = {}, matchKind = 'bracket') {
  return {
    matchId,
    round,
    position,
    matchKind,
    player1: toPlayerSide(p1),
    player2: toPlayerSide(p2),
    winner: winner ? toPlayerSide(winner) : null,
    status,
    resultStatus: status,
    courtId: assignment.courtId || null,
    queueOrder: assignment.queueOrder == null ? null : assignment.queueOrder,
  }
}

function schedulePlan(courts, now, queueItemsByCourt) {
  const slots = scheduleSlots(now)
  return {
    slotMinutes: 20,
    courts: courts.map(court => ({
      courtId: court.courtId || court._id,
      name: court.name || court.courtId || court._id,
      location: court.location || '',
      slots,
    })),
    queues: courts.map((court, index) => ({
      courtId: court.courtId || court._id,
      items: (queueItemsByCourt[index] || []).map(item => ({ ...item })),
    })),
  }
}

function scheduleSlots(now) {
  const base = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    0,
    0,
    0
  ))
  return [0, 20, 40].map(offset => {
    const d = new Date(base.getTime() + offset * 60 * 1000)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  })
}

function queueItem(sourceMatchId, order) {
  return { kind: 'match', matchId: sourceMatchId, sourceMatchId, order }
}

function courtAssignment(court, queueOrder) {
  return { courtId: court.courtId || court._id, queueOrder }
}

function cloneScore(score) {
  if (!score) return null
  return {
    sets: (score.sets || []).map(set => ({ ...set })),
    tiebreak: score.tiebreak == null ? null : score.tiebreak,
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  Object.values(value).forEach(deepFreeze)
  return value
}

function timestampKey(now) {
  const pad = n => String(n).padStart(2, '0')
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    '_',
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
  ].join('')
}

module.exports = {
  POINTS_RULES,
  DEFAULT_FIXTURE_NOW,
  SCORE_A_BEATS_B_4_2,
  SCORE_B_WINS_TIEBREAK,
  selectActors,
  buildE2EFixture,
}
