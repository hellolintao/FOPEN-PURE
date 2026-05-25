function loadPage() {
  jest.resetModules()
  let pageDef
  global.wx = {
    navigateTo: jest.fn(),
    showToast: jest.fn(),
    cloud: { callFunction: jest.fn() },
  }
  global.Page = (def) => { pageDef = def }
  require('../index')
  return pageDef
}

function makeCtx(def, data = {}) {
  return {
    ...def,
    data: { ...def.data, ...data },
    setData(patch) {
      Object.assign(this.data, patch)
    },
  }
}

test('edit schedule opens tournament edit in schedule-impact mode', () => {
  const def = loadPage()
  const ctx = makeCtx(def, { tournamentId: 't1' })

  ctx.onEditSchedule()

  expect(wx.navigateTo).toHaveBeenCalledWith({
    url: '/pages/tournament-edit/index?id=t1&step=3&mode=edit-schedule',
  })
})
