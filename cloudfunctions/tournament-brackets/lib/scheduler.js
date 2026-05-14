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

module.exports = { assignToCourts, assignToCourtsWithOverflow }
