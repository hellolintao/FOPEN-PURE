(async () => {
  const START_DATE = '2026-06-30'
  const BRACKET_SIZE = 12
  const GROUPS = ['A', 'B', 'C', 'D']
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const tournamentId = `tournament_gk12_${stamp}`
  const tournamentName = `GK12_E2E_${stamp}`
  const pointsRules = {
    winLoss: { win: 0, loss: 0, walkover: 0 },
    placement: { champion: 250, runnerUp: 150, semifinal: 100, quarterfinal: 65, participation: 0 },
    groupKnockout: {
      12: {
        placement: { champion: 250, runnerUp: 150, semifinal: 100, quarterfinal: 65 },
        group: { win: 20, loss: 10 }
      }
    }
  }

  const call = async (name, data, label) => {
    console.log(`[GK12] ${label || `${name}.${data && data.action}`}`)
    const res = await wx.cloud.callFunction({ name, data })
    const result = res && res.result
    const hasBadErrMsg = result && result.errMsg && !/:ok$/.test(String(result.errMsg))
    if (!result || result.success === false || hasBadErrMsg || result.error) {
      throw new Error(`${label || name} failed: ${JSON.stringify(result && result.error ? result.error : result)}`)
    }
    return Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const asPlayer = member => ({
    playerId: member._id || member.id || member.memberId,
    playerName: member.name || member.nickName || member.nickname || member.displayName || member.playerName || ''
  })
  const assert = (ok, message) => {
    if (!ok) throw new Error(message)
  }
  const saveScores = async (rows, label, scoreForRow) => {
    const payload = {
      action: 'batchAdminSave',
      requestId: `${tournamentId}_${label}_${Date.now()}`,
      matches: rows.map(row => ({ matchId: row._id, score: scoreForRow(row) }))
    }
    const data = await call('match-results', payload, `保存比分 ${label}`)
    assert(!data.failures || data.failures.length === 0, `${label} failures: ${JSON.stringify(data.failures)}`)
    await sleep(500)
    return data
  }
  const listRows = async () => {
    const data = await call('match-results', { action: 'listByTournament', tournamentId }, '读取比分行')
    return data.results || []
  }
  const readBracket = async () => call('tournament-brackets', { action: 'getGroupKnockoutBracket', tournamentId }, '读取签表')

  console.log(`[GK12] START ${tournamentId}`)
  const memberData = await call('members', { action: 'list', pageSize: 80 }, '读取会员')
  const players = (memberData || []).map(asPlayer).filter(p => p.playerId && p.playerName).slice(0, BRACKET_SIZE)
  assert(players.length === BRACKET_SIZE, `need 12 players, got ${players.length}`)

  const courtData = await call('courts', { action: 'list' }, '读取球场')
  const courts = ((courtData && courtData.courts) || []).slice(0, 4)
  const scheduleCourts = (courts.length ? courts : [{ courtId: 'gk12_devtools_court', name: '测试球场' }]).map((court, index) => ({
    courtId: court.courtId || court._id || `court_${index + 1}`,
    name: court.name || court.courtName || `球场${index + 1}`,
    slots: ['21:00', '22:00', '23:00'].map(time => `${START_DATE}T${time}:00+08:00`)
  }))

  const tournamentPayload = {
    _id: tournamentId,
    seasonId: 'season_2026',
    name: tournamentName,
    type: 'singles',
    format: 'group_knockout',
    startDate: START_DATE,
    endDate: START_DATE,
    location: '海峡奥体网球场',
    status: 'upcoming',
    scheduleStatus: 'none',
    schedulePlan: { slotMinutes: 20, courts: scheduleCourts, queues: [], freePlays: [] },
    bracketSize: BRACKET_SIZE,
    maxPlayers: BRACKET_SIZE,
    groupDrawMode: 'onsite',
    groupKnockoutPhase: 'group_draft',
    pointsRules
  }
  await call('tournaments', { action: 'create', data: tournamentPayload }, '创建赛事')
  await call('tournament-registrations', { action: 'bulkSet', tournamentId, registrations: players }, '录入12人报名')

  const groups = GROUPS.map((groupCode, groupIndex) => ({
    groupCode,
    slots: [1, 2, 3].map(slotNo => {
      const player = players[groupIndex * 3 + slotNo - 1]
      return { slotNo, playerId: player.playerId, playerName: player.playerName }
    })
  }))
  await call('tournament-brackets', { action: 'saveGroups', tournamentId, groups }, '保存A-D小组签表')
  await call('tournament-brackets', { action: 'generateGroupMatches', tournamentId }, '生成12场小组赛')

  let rows = await listRows()
  let groupRows = rows.filter(row => row.stage === 'group').sort((a, b) => `${a.groupCode}${a.position}`.localeCompare(`${b.groupCode}${b.position}`))
  assert(groupRows.length === 12, `expected 12 group rows, got ${groupRows.length}`)
  await saveScores(groupRows, 'group', row => ({
    sets: [{ a: 4, b: row.groupSlot2 === 2 ? 1 : 0 }],
    tiebreak: null
  }))

  let tournamentDoc = await call('tournaments', { action: 'get', id: tournamentId }, '确认小组赛完成')
  assert(tournamentDoc.groupKnockoutPhase === 'group_completed', `expected group_completed, got ${tournamentDoc.groupKnockoutPhase}`)

  const seedData = await call('tournament-brackets', { action: 'confirmKnockoutSeeds', tournamentId }, '确认8强种子并生成淘汰赛')
  const seeds = seedData.seeds
  assert(seeds && seeds.A1 && seeds.A2 && seeds.B1 && seeds.B2 && seeds.C1 && seeds.C2 && seeds.D1 && seeds.D2, 'missing knockout seeds')

  let bracketData = await readBracket()
  const qf = (bracketData.knockoutBrackets || []).find(bracket => bracket.round === 1)
  const qfSources = (qf && qf.matches || []).map(match => `${match.player1Source}-${match.player2Source}`)
  assert(JSON.stringify(qfSources) === JSON.stringify(['A1-C2', 'B1-D2', 'C1-A2', 'D1-B2']), `bad qf sources ${JSON.stringify(qfSources)}`)
  const laterSourceLeak = (bracketData.knockoutBrackets || [])
    .filter(bracket => bracket.round > 1)
    .some(bracket => (bracket.matches || []).some(match => match.player1Source || match.player2Source))
  assert(!laterSourceLeak, 'source labels leaked outside quarterfinal')

  rows = await listRows()
  let koRows = rows.filter(row => row.stage === 'knockout' && row.round === 1).sort((a, b) => a.position - b.position)
  assert(koRows.length === 4, `expected 4 quarterfinal rows, got ${koRows.length}`)
  await saveScores(koRows, 'qf', () => ({ sets: [{ a: 4, b: 2 }], tiebreak: null }))

  rows = await listRows()
  koRows = rows.filter(row => row.stage === 'knockout' && row.round === 2 && row.player1 && row.player2).sort((a, b) => a.position - b.position)
  assert(koRows.length === 2, `expected 2 semifinal rows, got ${koRows.length}`)
  await saveScores(koRows, 'sf', () => ({ sets: [{ a: 4, b: 2 }], tiebreak: null }))

  rows = await listRows()
  koRows = rows.filter(row => row.stage === 'knockout' && row.round === 3 && row.player1 && row.player2)
  assert(koRows.length === 1, `expected 1 final row, got ${koRows.length}`)
  await saveScores(koRows, 'final', () => ({ sets: [{ a: 4, b: 2 }], tiebreak: null }))

  for (let i = 0; i < 8; i += 1) {
    tournamentDoc = await call('tournaments', { action: 'get', id: tournamentId }, '轮询完赛状态')
    if (tournamentDoc.status === 'completed' && tournamentDoc.groupKnockoutPhase === 'completed') break
    await sleep(800)
  }
  assert(tournamentDoc.status === 'completed', `expected status completed, got ${tournamentDoc.status}`)
  assert(tournamentDoc.groupKnockoutPhase === 'completed', `expected phase completed, got ${tournamentDoc.groupKnockoutPhase}`)

  rows = await listRows()
  assert(rows.length === 19, `expected 19 score rows, got ${rows.length}`)
  assert(rows.every(row => row.resultStatus === 'confirmed'), 'not all score rows are confirmed')

  const pointsByMember = {}
  rows.forEach(row => ((row.pointsAwarded && row.pointsAwarded.entries) || []).forEach(entry => {
    pointsByMember[entry.memberId] = (pointsByMember[entry.memberId] || 0) + (entry.points || 0)
  }))
  const expected = {}
  expected[seeds.A1.id] = 250
  expected[seeds.C1.id] = 150
  expected[seeds.B1.id] = 100
  expected[seeds.D1.id] = 100
  ;['C2', 'D2', 'A2', 'B2'].forEach(key => { expected[seeds[key].id] = 65 })
  groups.forEach(group => {
    const slot3 = group.slots.find(slot => slot.slotNo === 3)
    expected[slot3.playerId] = 20
  })
  Object.keys(expected).forEach(memberId => {
    assert(pointsByMember[memberId] === expected[memberId], `points mismatch ${memberId}: expected ${expected[memberId]}, got ${pointsByMember[memberId] || 0}`)
  })

  bracketData = await readBracket()
  const finalBracket = (bracketData.knockoutBrackets || []).find(bracket => bracket.round === 3)
  const champion = finalBracket && finalBracket.matches && finalBracket.matches[0] && finalBracket.matches[0].winner
  assert(champion && champion.id === seeds.A1.id, `expected A1 champion, got ${champion && champion.id}`)

  const nameById = Object.fromEntries(players.map(player => [player.playerId, player.playerName]))
  const summary = {
    tournamentId,
    tournamentName,
    players: players.map((player, index) => ({ seed: index + 1, id: player.playerId, name: player.playerName })),
    groups: groups.map(group => ({ groupCode: group.groupCode, players: group.slots.map(slot => `${slot.slotNo}.${slot.playerName}`) })),
    qfSources,
    champion: champion.name,
    points: Object.fromEntries(Object.entries(expected).map(([memberId]) => [nameById[memberId] || memberId, pointsByMember[memberId]])),
    counts: {
      scoreRows: rows.length,
      groupRows: rows.filter(row => row.stage === 'group').length,
      knockoutRows: rows.filter(row => row.stage === 'knockout').length
    }
  }
  console.log('GK12_E2E_DONE ' + JSON.stringify(summary))
  wx.navigateTo({ url: `/pages/tournament-detail/index?id=${tournamentId}` })
})().catch(err => {
  console.error('GK12_E2E_FAIL', err)
})
