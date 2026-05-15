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
  if (players.length < 2 || matchCount <= 0) return []

  const counts = new Map(players.map(p => [p.playerId, 0]))
  const pairCounts = new Map()
  const matches = []

  for (let i = 0; i < matchCount; i++) {
    const [p1, p2] = pickBalancedPair(players, counts, pairCounts)
    const key = pairKey(p1.playerId, p2.playerId)
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1)
    counts.set(p1.playerId, (counts.get(p1.playerId) || 0) + 1)
    counts.set(p2.playerId, (counts.get(p2.playerId) || 0) + 1)
    matches.push(regularMatchFromPair(p1, p2, i, type, now))
  }

  return matches
}

function pickBalancedPair(players, counts, pairCounts) {
  let best = null
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i]
      const b = players[j]
      const ca = counts.get(a.playerId) || 0
      const cb = counts.get(b.playerId) || 0
      const score = [
        Math.max(ca, cb),
        ca + cb,
        pairCounts.get(pairKey(a.playerId, b.playerId)) || 0,
        Math.abs(ca - cb),
        i,
        j
      ]
      if (!best || compareScore(score, best.score) < 0) best = { pair: [a, b], score }
    }
  }
  return best.pair
}

function regularMatchFromPair(p1, p2, index, type, now) {
  return {
    matchId: `match_regular_p${index + 1}_${now}_${index}`,
    round: 1,
    position: index + 1,
    player1: playerObject(p1, type),
    player2: playerObject(p2, type),
    bye: false,
    status: 'pending',
    resultStatus: 'pending',
    winner: null,
    courtId: null,
    queueOrder: null,
    matchKind: 'regularRound'
  }
}

function playerObject(registration, type) {
  const out = {
    id: registration.playerId,
    name: registration.playerName,
    registrationId: registration.registrationId
  }
  if (type === 'doubles' && registration.partnerId) {
    out.partnerId = registration.partnerId
    out.partnerName = registration.partnerName
  }
  return out
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

function pairKey(a, b) {
  return [a, b].sort().join('|')
}

function compareScore(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
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
