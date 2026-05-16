const {
  selectActors,
  buildE2EFixture,
  SCORE_A_BEATS_B_4_2,
  SCORE_B_WINS_TIEBREAK,
} = require('../lib/e2e-fixture')

const members = [
  { _id: 'admin', name: 'Admin', admin: true, openid: 'oa' },
  { _id: 'A', name: 'A' },
  { _id: 'B', name: 'B' },
  { _id: 'C', name: 'C' },
  { _id: 'D', name: 'D' },
  { _id: 'E', name: 'E' },
]
const courts = [
  { _id: 'court1', courtId: 'court1', name: 'Court 1', enabled: true },
  { _id: 'court2', courtId: 'court2', name: 'Court 2', enabled: true },
]

function buildFixture() {
  return buildE2EFixture({
    actors: selectActors({ members, courts }),
    seasonId: 'season_2026',
    now: new Date('2026-05-17T10:00:00.000Z'),
  })
}

describe('selectActors', () => {
  test('selects one admin, five normal members, and two enabled courts', () => {
    const actors = selectActors({ members, courts })
    expect(actors.adminMember._id).toBe('admin')
    expect(actors.players.map(p => p._id)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(actors.courts.map(c => c.courtId)).toEqual(['court1', 'court2'])
  })
})

describe('buildE2EFixture', () => {
  test('uses current score schema for straight score and tiebreak score', () => {
    expect(SCORE_A_BEATS_B_4_2).toEqual({ sets: [{ a: 4, b: 2 }], tiebreak: null })
    expect(SCORE_B_WINS_TIEBREAK).toEqual({ sets: [{ a: 3, b: 3 }], tiebreak: '5-7' })
  })

  test('builds confirmed and interactive fixture subsets', () => {
    const fixture = buildFixture()

    expect(fixture.ids.regularSinglesTournamentId).toBe('e2e_regular_singles_20260517_1000')
    expect(fixture.collections.tournaments).toHaveLength(4)
    expect(fixture.collections.match_results.some(r => r.resultStatus === 'confirmed')).toBe(true)
    expect(fixture.collections.match_results.some(r => r.resultStatus === 'pending')).toBe(true)
    expect(fixture.collections.match_results.some(r => r.resultStatus === 'submitted')).toBe(true)
    expect(fixture.collections.tournament_points.some(p => p.rank === 'champion')).toBe(true)
  })

  test('doubles fixture contains four playerIds and opposite-side award roles', () => {
    const fixture = buildFixture()
    const doubles = fixture.collections.match_results.find(r => r.tournamentType === 'doubles' && r.resultStatus === 'confirmed')
    expect(doubles.playerIds).toEqual(['A', 'B', 'C', 'D'])
    expect(doubles.pointsAwarded.entries.filter(e => e.role === 'winner').map(e => e.memberId)).toEqual(['A', 'B'])
    expect(doubles.pointsAwarded.entries.filter(e => e.role === 'loser').map(e => e.memberId)).toEqual(['C', 'D'])
  })

  test('registrations include season, type, deterministic seed, and confirmed statuses', () => {
    const fixture = buildFixture()
    const regularRegistrations = fixture.collections.tournament_registrations
      .filter(r => r.tournamentId === fixture.ids.regularSinglesTournamentId)

    expect(regularRegistrations).toEqual([
      expect.objectContaining({
        seasonId: 'season_2026',
        type: 'singles',
        seed: 1,
        status: 'confirmed',
        registrationStatus: 'confirmed',
        partnerId: null,
        partnerName: null,
        teamName: '',
        registerTime: new Date('2026-05-17T10:00:00.000Z'),
      }),
      expect.objectContaining({
        seasonId: 'season_2026',
        type: 'singles',
        seed: 2,
        status: 'confirmed',
        registrationStatus: 'confirmed',
        partnerId: null,
        partnerName: null,
        teamName: '',
        registerTime: new Date('2026-05-17T10:00:00.000Z'),
      }),
      expect.objectContaining({
        seasonId: 'season_2026',
        type: 'singles',
        seed: 3,
        status: 'confirmed',
        registrationStatus: 'confirmed',
        partnerId: null,
        partnerName: null,
        teamName: '',
        registerTime: new Date('2026-05-17T10:00:00.000Z'),
      }),
      expect.objectContaining({
        seasonId: 'season_2026',
        type: 'singles',
        seed: 4,
        status: 'confirmed',
        registrationStatus: 'confirmed',
        partnerId: null,
        partnerName: null,
        teamName: '',
        registerTime: new Date('2026-05-17T10:00:00.000Z'),
      }),
    ])
  })

  test('tournaments include selected court schedulePlan and interactive matches are queued', () => {
    const fixture = buildFixture()
    expect(fixture.collections.tournaments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        schedulePlan: expect.objectContaining({
          slotMinutes: 20,
          courts: [
            expect.objectContaining({ courtId: 'court1', name: 'Court 1', slots: expect.any(Array) }),
            expect.objectContaining({ courtId: 'court2', name: 'Court 2', slots: expect.any(Array) }),
          ],
          queues: expect.any(Array),
        }),
      }),
    ]))

    const interactiveRows = fixture.collections.match_results
      .filter(r => r.tournamentId === fixture.ids.interactiveTournamentId)
      .sort((a, b) => a.position - b.position)
    expect(interactiveRows.map(r => ({ courtId: r.courtId, queueOrder: r.queueOrder }))).toEqual([
      { courtId: 'court1', queueOrder: 0 },
      { courtId: 'court2', queueOrder: 0 },
    ])
  })

  test('schedule queue match ids resolve to round-one bracket matches for every scheduled tournament', () => {
    const fixture = buildFixture()
    for (const tournament of fixture.collections.tournaments) {
      const queuedIds = tournament.schedulePlan.queues
        .flatMap(q => q.items)
        .filter(item => item.kind === 'match')
        .map(item => item.matchId)
      if (queuedIds.length === 0) continue

      const r1MatchIds = fixture.collections.tournament_brackets
        .filter(b => b.tournamentId === tournament._id && b.round === 1)
        .flatMap(b => b.matches)
        .map(m => m.matchId)
      expect(r1MatchIds).toEqual(expect.arrayContaining(queuedIds))
    }
  })

  test('interactive round-one bracket rows carry status and court queue metadata', () => {
    const fixture = buildFixture()
    const interactiveR1 = fixture.collections.tournament_brackets
      .find(b => b.tournamentId === fixture.ids.interactiveTournamentId && b.round === 1)

    expect(interactiveR1.matches.map(m => ({
      matchId: m.matchId,
      resultStatus: m.resultStatus,
      courtId: m.courtId,
      queueOrder: m.queueOrder,
    }))).toEqual([
      { matchId: 'int_pending', resultStatus: 'pending', courtId: 'court1', queueOrder: 0 },
      { matchId: 'int_submitted', resultStatus: 'submitted', courtId: 'court2', queueOrder: 0 },
    ])
  })

  test('omitted now uses a deterministic default timestamp', () => {
    const actors = selectActors({ members, courts })
    const first = buildE2EFixture({ actors, seasonId: 'season_2026' })
    const second = buildE2EFixture({ actors, seasonId: 'season_2026' })

    expect(first.ids).toEqual(second.ids)
    expect(first.ids.regularSinglesTournamentId).toBe('e2e_regular_singles_20260517_1000')
  })

  test('score objects are not shared between rows or exported constants', () => {
    const fixture = buildFixture()
    const straightRows = fixture.collections.match_results
      .filter(r => r.score && r.score.tiebreak === null)
    straightRows[0].score.sets[0].a = 99

    expect(straightRows[1].score.sets[0].a).not.toBe(99)
    expect(SCORE_A_BEATS_B_4_2).toEqual({ sets: [{ a: 4, b: 2 }], tiebreak: null })
  })

  test('every non-empty seeded collection document has an _id', () => {
    const fixture = buildFixture()
    for (const [collectionName, rows] of Object.entries(fixture.collections)) {
      for (const row of rows) {
        expect(row).toHaveProperty('_id')
        expect(row._id).toEqual(expect.any(String))
        expect(row._id).not.toBe('')
      }
      if (rows.length > 0) expect(collectionName).toEqual(expect.any(String))
    }
  })
})
