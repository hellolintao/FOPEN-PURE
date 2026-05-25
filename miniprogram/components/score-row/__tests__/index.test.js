let def

global.Component = (d) => { def = d }
global.wx = { showToast: jest.fn(), showModal: jest.fn() }

require('../index')

function makeCtx(data = {}) {
  return {
    data: {
      expanded: false,
      draftA: 0,
      draftB: 0,
      tbA: '',
      tbB: '',
      tbFocus: '',
      validationError: '',
      filled: false,
      dirty: false,
      submitDisabled: false,
      originalScoreKey: '',
      isDoubles: false,
      isBye: false,
      isMissingPlayer: false,
      isVoided: false,
      canEdit: false,
      statusLabel: '',
      submitLabel: '',
      showTbInput: false,
      match: null,
      isAdmin: false,
      currentMemberId: '',
      ...data,
    },
    setData(patch) {
      Object.assign(this.data, patch)
    },
    triggerEvent: jest.fn(),
    ...def.methods,
  }
}

const match = {
  sourceMatchId: 'm1',
  resultStatus: 'pending',
  playerIds: ['p1', 'p2'],
  player1: { id: 'p1', name: 'A' },
  player2: { id: 'p2', name: 'B' },
}

test('non-admin cannot edit a match they do not participate in', () => {
  const ctx = makeCtx({ match, isAdmin: false, currentMemberId: 'p9' })

  ctx._recomputeFlags(match, false, 'p9')

  expect(ctx.data.canEdit).toBe(false)
})

test('non-admin can edit their own unconfirmed match', () => {
  const ctx = makeCtx({ match, isAdmin: false, currentMemberId: 'p1' })

  ctx._recomputeFlags(match, false, 'p1')

  expect(ctx.data.canEdit).toBe(true)
})

test('admin can mark an unfinished match as voided', () => {
  const ctx = makeCtx({ match, isAdmin: true, currentMemberId: 'admin1' })
  wx.showModal.mockImplementationOnce(({ success }) => success({ confirm: true }))

  ctx._recomputeFlags(match, true, 'admin1')
  ctx.onVoidMatch()

  expect(ctx.triggerEvent).toHaveBeenCalledWith('voidmatch', { matchId: 'm1' })
})

test('admin void action uses result document id when available', () => {
  const persisted = { ...match, _id: 'result_t1_m1' }
  const ctx = makeCtx({ match: persisted, isAdmin: true, currentMemberId: 'admin1' })
  wx.showModal.mockImplementationOnce(({ success }) => success({ confirm: true }))

  ctx._recomputeFlags(persisted, true, 'admin1')
  ctx.onVoidMatch()

  expect(ctx.triggerEvent).toHaveBeenCalledWith('voidmatch', { matchId: 'result_t1_m1' })
})

test('voided match shows no-score label and remains editable by admin for correction', () => {
  const voided = { ...match, resultStatus: 'voided', status: 'cancelled', voidReason: '未完赛' }
  const ctx = makeCtx({ match: voided, isAdmin: true, currentMemberId: 'admin1' })

  ctx._recomputeFlags(voided, true, 'admin1')

  expect(ctx.data.statusLabel).toBe('未赛')
  expect(ctx.data.isVoided).toBe(true)
  expect(ctx.data.canEdit).toBe(true)
})

test('confirmed match with void marker shows no-score label for legacy database compatibility', () => {
  const voided = {
    ...match,
    resultStatus: 'confirmed',
    status: 'completed',
    score: null,
    winner: null,
    winnerId: null,
    pointsAwarded: { source: 'match', entries: [] }
  }
  const ctx = makeCtx({ match: voided, isAdmin: true, currentMemberId: 'admin1' })

  ctx._recomputeFlags(voided, true, 'admin1')

  expect(ctx.data.statusLabel).toBe('未赛')
  expect(ctx.data.isVoided).toBe(true)
  expect(ctx.data.showVoidAction).toBe(false)
})
