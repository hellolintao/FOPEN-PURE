// Phase 7 vendored copy of cloudfunctions/tournament-brackets/lib/scheduler.js
// Keep CommonJS module.exports for Phase 8 sync-shared-libs.sh hash compatibility.
// Do NOT convert to ES module — small program supports CommonJS require.

function assignToCourts(matches, courts) {
  return assignToCourtsWithOverflow(matches, courts).queues
}

function assignToCourtsWithOverflow(matches, courts) {
  if (!courts || courts.length === 0) {
    return { queues: [], unscheduled: [...matches] }
  }

  const queues = courts.map(c => ({ courtId: c.courtId, items: [] }))
  const unscheduled = []
  let cursor = 0

  for (const m of matches) {
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
