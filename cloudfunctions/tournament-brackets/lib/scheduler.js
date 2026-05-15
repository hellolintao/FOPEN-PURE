/**
 * scheduler.js — 顺序填满场地 (sequentially fill courts) algorithm
 *
 * Assigns matches to courts in order: court[0] is filled to its slot capacity
 * before any matches spill into court[1], and so on.
 *
 * Pure algorithm — no wx-server-sdk dependency, no DB I/O.
 */

/**
 * Assign matches to courts sequentially, filling each court to capacity before
 * moving to the next. Returns only the queues array (no overflow tracking).
 *
 * @param {Array<{matchId: string, kind?: string, sourceMatchId?: string}>} matches
 * @param {Array<{courtId: string, slots: Array<string>}>} courts
 * @returns {Array<{courtId: string, items: Array<object>}>}
 */
function assignToCourts(matches, courts) {
  return assignToCourtsWithOverflow(matches, courts).queues
}

/**
 * Assign matches to courts sequentially, filling each court to its slot
 * capacity before moving to the next. Matches that exceed total capacity are
 * returned in `unscheduled`.
 *
 * @param {Array<{matchId: string, kind?: string, sourceMatchId?: string}>} matches
 * @param {Array<{courtId: string, slots: Array<string>}>} courts
 * @returns {{ queues: Array<{courtId: string, items: Array<object>}>, unscheduled: Array<object> }}
 */
function assignToCourtsWithOverflow(matches, courts) {
  if (!courts || courts.length === 0) {
    return { queues: [], unscheduled: [...matches] }
  }

  const queues = courts.map(c => ({ courtId: c.courtId, items: [] }))
  const unscheduled = []
  let cursor = 0

  for (const m of matches) {
    // Advance cursor past any courts already at capacity
    while (cursor < courts.length && queues[cursor].items.length >= courts[cursor].slots.length) cursor++

    if (cursor >= courts.length) {
      unscheduled.push(m)
      continue
    }

    const q = queues[cursor]
    q.items.push({
      kind: m.kind || 'match',
      matchId: m.matchId,
      sourceMatchId: m.sourceMatchId || m.matchId,
      order: q.items.length
    })
  }

  return { queues, unscheduled }
}

function buildRegularSchedule({ registrations, courts, type, now }) {
  const timestamp = now || Date.now()
  const plan = buildRegularSlotPlan(courts || [])
  // 随机打乱报名顺序，避免 balanced pair 算法因稳定排序产生相同结果
  const shuffledRegs = shuffleArray(registrations || [])
  const matches = generateBalancedRegularMatches({
    registrations: shuffledRegs,
    matchCount: plan.matchCells.length,
    type,
    now: timestamp
  })
  const freePlays = []
  const queues = (courts || []).map(court => ({ courtId: court.courtId, items: [] }))
  let matchIndex = 0
  let freeIndex = 0

  plan.cells.forEach(cell => {
    const q = queues.find(x => x.courtId === cell.courtId)
    if (!q) return
    const order = q.items.length
    if (cell.kind === 'match') {
      const match = matches[matchIndex++]
      if (!match) return
      q.items.push({ kind: 'match', matchId: match.matchId, sourceMatchId: match.matchId, order })
    } else {
      const fpId = `fp_${cell.courtId}_${sanitizeIdPart(cell.slot || order)}_${timestamp}_${freeIndex++}`
      q.items.push({ kind: 'freePlay', matchId: fpId, freePlayId: fpId, order })
      freePlays.push({ _id: fpId, courtId: cell.courtId, queueOrder: order, playerIds: [] })
    }
  })

  return { matches, queues, freePlays }
}

function buildRegularSlotPlan(courts) {
  const cells = []
  const matchCells = []

  courts.forEach(court => {
    const grouped = groupSlotsByHour(court.slots || [])
    grouped.forEach(group => {
      group.slots.forEach((slot, index) => {
        const kind = index < 2 ? 'match' : 'freePlay'
        const cell = { courtId: court.courtId, slot, kind }
        cells.push(cell)
        if (kind === 'match') matchCells.push(cell)
      })
    })
  })

  return { cells, matchCells }
}

function generateBalancedRegularMatches({ registrations, matchCount, type, now }) {
  const players = [...(registrations || [])]
  const perMatch = type === 'doubles' ? 4 : 2
  if (players.length < perMatch || matchCount <= 0) return []

  const counts = new Map(players.map(p => [p.playerId, 0]))
  const matches = []

  for (let i = 0; i < matchCount; i++) {
    const picked = pickBalancedNPlayers(players, counts, perMatch)
    picked.forEach(p => counts.set(p.playerId, (counts.get(p.playerId) || 0) + 1))
    matches.push(regularMatchFromGroup(picked, i, type, now))
  }

  return matches
}

function pickBalancedNPlayers(players, counts, N) {
  const ranked = players.map(p => ({
    p,
    c: counts.get(p.playerId) || 0,
    r: Math.random()
  }))
  ranked.sort((a, b) => (a.c !== b.c ? a.c - b.c : a.r - b.r))
  return ranked.slice(0, N).map(x => x.p)
}

function regularMatchFromGroup(group, index, type, now) {
  if (type === 'doubles') {
    const s = shuffleArray(group)
    return {
      matchId: `match_regular_p${index + 1}_${now}_${index}`,
      round: 1,
      position: index + 1,
      player1: doublesTeam(s[0], s[1]),
      player2: doublesTeam(s[2], s[3]),
      bye: false,
      status: 'pending',
      resultStatus: 'pending',
      winner: null,
      courtId: null,
      queueOrder: null,
      matchKind: 'regularRound'
    }
  }
  const [p1, p2] = group
  return {
    matchId: `match_regular_p${index + 1}_${now}_${index}`,
    round: 1,
    position: index + 1,
    player1: singlesPlayer(p1),
    player2: singlesPlayer(p2),
    bye: false,
    status: 'pending',
    resultStatus: 'pending',
    winner: null,
    courtId: null,
    queueOrder: null,
    matchKind: 'regularRound'
  }
}

function singlesPlayer(reg) {
  return {
    id: reg.playerId,
    name: reg.playerName,
    registrationId: reg.registrationId
  }
}

function doublesTeam(a, b) {
  return {
    id: a.playerId,
    name: a.playerName,
    registrationId: a.registrationId,
    partnerId: b.playerId,
    partnerName: b.playerName
  }
}

function groupSlotsByHour(slots) {
  const map = {}
  ;[...(slots || [])].sort().forEach(slot => {
    const key = hourKey(slot)
    if (!map[key]) map[key] = []
    map[key].push(slot)
  })
  return Object.keys(map).sort().map(key => ({ hour: key, slots: map[key] }))
}

function hourKey(slot) {
  const m = /T(\d{2}):/.exec(slot || '')
  return m ? `${(slot || '').slice(0, (slot || '').indexOf('T'))}T${m[1]}` : String(slot || '')
}

function sanitizeIdPart(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '')
}

function shuffleArray(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

module.exports = {
  assignToCourts,
  assignToCourtsWithOverflow,
  buildRegularSchedule,
  generateBalancedRegularMatches
}
