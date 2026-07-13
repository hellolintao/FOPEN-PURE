const {
  resolveGroupKnockoutPhase,
  canExposeScoreRows,
  canWriteScoreRows
} = require('../score-access')

describe('group knockout score access matrix', () => {
  test.each([
    ['completed missing', { status: 'completed' }, 'completed'],
    ['settled invalid', { status: 'settled', groupKnockoutPhase: 'unknown_phase' }, 'completed'],
    ['upcoming blank', { status: 'upcoming', groupKnockoutPhase: '   ' }, 'group_draft'],
    ['draft stale published', { status: 'draft', groupKnockoutPhase: 'group_published' }, 'group_draft'],
    ['trimmed legal', { status: 'upcoming', groupKnockoutPhase: ' knockout_published ' }, 'knockout_published'],
    ['cancelled history', { status: 'cancelled', groupKnockoutPhase: 'completed' }, 'completed']
  ])('resolves %s', (_label, fields, expected) => {
    expect(resolveGroupKnockoutPhase({ format: 'group_knockout', ...fields })).toBe(expected)
  })

  test.each([
    ['completed missing', { status: 'completed' }, true, false],
    ['settled invalid', { status: 'settled', groupKnockoutPhase: 'unknown_phase' }, true, false],
    ['completed explicit draft', { status: 'completed', groupKnockoutPhase: 'group_draft' }, false, false],
    ['upcoming missing', { status: 'upcoming' }, false, false],
    ['draft stale published', { status: 'draft', groupKnockoutPhase: 'group_published' }, false, false],
    ['cancelled group stage', { status: 'cancelled', groupKnockoutPhase: 'group_published' }, true, false],
    ['cancelled completed history', { status: 'cancelled', groupKnockoutPhase: 'completed' }, true, false],
    ['completed explicit history', { status: 'completed', groupKnockoutPhase: 'completed' }, true, true],
    ['completed resettlement', { status: 'completed', groupKnockoutPhase: 'knockout_published' }, true, true],
    ['settled resettlement', { status: 'settled', groupKnockoutPhase: 'knockout_published' }, true, true]
  ])('%s has independent read/write access', (_label, fields, readable, writable) => {
    const tournament = { format: 'group_knockout', scheduleStatus: 'none', ...fields }
    expect(canExposeScoreRows(tournament)).toBe(readable)
    expect(canWriteScoreRows(tournament)).toBe(writable)
  })
})
