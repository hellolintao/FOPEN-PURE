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
