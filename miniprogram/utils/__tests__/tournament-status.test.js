const {
  getTournamentStatusMeta,
  decorateTournamentStatus,
  getTournamentShareTitle
} = require('../tournament-status')

describe('tournament status helpers', () => {
  test('normalizes tournament lifecycle status for display', () => {
    expect(getTournamentStatusMeta('draft')).toMatchObject({
      kind: 'draft',
      label: '草稿',
      scoreActionLabel: '录入成绩',
      canShare: false
    })
    expect(getTournamentStatusMeta('live')).toMatchObject({
      kind: 'ongoing',
      label: '进行中'
    })
    expect(getTournamentStatusMeta('completed')).toMatchObject({
      kind: 'settled',
      label: '已结算',
      scoreActionLabel: '查看成绩',
      canShare: true
    })
  })

  test('derives active display status from tournament date when not settled', () => {
    expect(getTournamentStatusMeta({
      status: 'upcoming',
      startDate: '2099-01-01'
    }, { now: '2026-05-19T12:00:00+08:00' })).toMatchObject({
      kind: 'upcoming',
      label: '待开始'
    })

    expect(getTournamentStatusMeta({
      status: 'upcoming',
      startDate: '2026-05-19',
      endDate: '2026-05-19'
    }, { now: '2026-05-19T12:00:00+08:00' })).toMatchObject({
      kind: 'ongoing',
      label: '进行中'
    })

    expect(getTournamentStatusMeta({
      status: 'ongoing',
      startDate: '2026-05-17',
      endDate: '2026-05-18'
    }, { now: '2026-05-19T12:00:00+08:00' })).toMatchObject({
      kind: 'ended',
      label: '已结束',
      scoreActionLabel: '录入成绩'
    })
  })

  test('derives active display status from precise schedule slots when available', () => {
    const tournament = {
      status: 'upcoming',
      startDate: '2026-05-19',
      schedulePlan: {
        slotMinutes: 20,
        courts: [
          {
            courtId: 'c1',
            slots: [
              '2026-05-19T20:00',
              '2026-05-19T20:20',
              '2026-05-19T20:40',
              '2026-05-19T21:00',
              '2026-05-19T21:20',
              '2026-05-19T21:40'
            ]
          }
        ]
      }
    }

    expect(getTournamentStatusMeta(tournament, { now: '2026-05-19T19:59:00' })).toMatchObject({
      kind: 'upcoming',
      label: '待开始'
    })
    expect(getTournamentStatusMeta(tournament, { now: '2026-05-19T20:00:00' })).toMatchObject({
      kind: 'ongoing',
      label: '进行中'
    })
    expect(getTournamentStatusMeta(tournament, { now: '2026-05-19T21:59:00' })).toMatchObject({
      kind: 'ongoing',
      label: '进行中'
    })
    expect(getTournamentStatusMeta(tournament, { now: '2026-05-19T22:00:00' })).toMatchObject({
      kind: 'ended',
      label: '已结束'
    })
  })

  test('uses tournament date for schedule slots that only contain time', () => {
    expect(getTournamentStatusMeta({
      status: 'upcoming',
      startDate: '2026-05-19',
      schedulePlan: {
        slotMinutes: 20,
        courts: [{ courtId: 'c1', slots: ['T08:00', 'T08:20', 'T08:40'] }]
      }
    }, { now: '2026-05-19T07:59:00' })).toMatchObject({
      kind: 'upcoming',
      label: '待开始'
    })

    expect(getTournamentStatusMeta({
      status: 'upcoming',
      startDate: '2026-05-19',
      schedulePlan: {
        slotMinutes: 20,
        courts: [{ courtId: 'c1', slots: ['T08:00', 'T08:20', 'T08:40'] }]
      }
    }, { now: '2026-05-19T09:00:00' })).toMatchObject({
      kind: 'ended',
      label: '已结束'
    })
  })

  test('treats all confirmed playable matches as settled even when stored status is stale', () => {
    expect(getTournamentStatusMeta({
      status: 'upcoming',
      startDate: '2099-01-01',
      resultSummary: { playableCount: 2, confirmedCount: 2 }
    }, { now: '2026-05-19T12:00:00+08:00' })).toMatchObject({
      kind: 'settled',
      label: '已结算',
      scoreActionLabel: '查看成绩'
    })
  })

  test('uses new registration phase labels when phase fields are present', () => {
    expect(getTournamentStatusMeta({
      status: 'draft',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
      scheduleStatus: 'none'
    }, { now: '2026-05-21T12:00:00+08:00' })).toMatchObject({
      kind: 'registration',
      label: '报名中',
      hint: '可报名',
      scoreActionLabel: '我要报名',
      canShare: true
    })

    expect(getTournamentStatusMeta({
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-21T10:00:00+08:00',
      scheduleStatus: 'none'
    }, { now: '2026-05-21T12:00:00+08:00' })).toMatchObject({
      kind: 'pendingSchedule',
      label: '待排程',
      hint: '报名已截止',
      scoreActionLabel: '等待赛程'
    })
  })

  test('keeps cancelled lifecycle meta when registration fields are present', () => {
    expect(getTournamentStatusMeta({
      status: 'cancelled',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
      scheduleStatus: 'none'
    }, { now: '2026-05-21T12:00:00+08:00' })).toMatchObject({
      kind: 'cancelled',
      label: '已取消',
      hint: '赛事已取消',
      canShare: false
    })
  })

  test('uses new schedule and result phase labels when phase fields are present', () => {
    expect(getTournamentStatusMeta({
      scheduleStatus: 'draft',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00'
    }, { now: '2026-05-21T12:00:00+08:00' })).toMatchObject({
      kind: 'scheduleDraft',
      label: '赛程待发布',
      hint: '草稿仅管理员可见',
      scoreActionLabel: '发布赛程'
    })

    expect(getTournamentStatusMeta({
      scheduleStatus: 'published',
      resultSummary: { playableCount: 1, confirmedCount: 0 }
    }, { now: '2026-05-21T12:00:00+08:00' })).toMatchObject({
      kind: 'upcoming',
      label: '赛程已发布',
      hint: '可录分',
      scoreActionLabel: '录入成绩'
    })

    expect(getTournamentStatusMeta({
      scheduleStatus: 'published',
      resultSummary: { playableCount: 1, confirmedCount: 1 }
    }, { now: '2026-05-21T12:00:00+08:00' })).toMatchObject({
      kind: 'settled',
      label: '已结算',
      scoreActionLabel: '查看成绩'
    })
  })

  test('uses group knockout phase instead of registration timing after bracket advances', () => {
    expect(getTournamentStatusMeta({
      format: 'group_knockout',
      type: 'singles',
      groupKnockoutPhase: 'knockout_published',
      status: 'upcoming',
      startDate: '2026-05-29',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-31T23:59:00+08:00',
      scheduleStatus: 'none'
    }, { now: '2026-05-29T12:19:00+08:00' })).toMatchObject({
      kind: 'ongoing',
      label: '淘汰赛进行中',
      hint: '淘汰赛进行中',
      scoreActionLabel: '录入赛果'
    })
  })

  test('keeps legacy date-window behavior when new phase fields are absent', () => {
    expect(getTournamentStatusMeta({
      status: 'upcoming',
      startDate: '2026-05-19',
      endDate: '2026-05-19'
    }, { now: '2026-05-19T12:00:00+08:00' })).toMatchObject({
      kind: 'ongoing',
      label: '进行中'
    })
  })

  test('decorates tournament rows with stable status display fields', () => {
    const row = decorateTournamentStatus({ _id: 't1', name: 'FU Open', status: 'ongoing' })

    expect(row.__statusKind).toBe('ongoing')
    expect(row.__statusLabel).toBe('进行中')
    expect(row.__statusHint).toBe('赛事进行中')
    expect(row.__scoreActionLabel).toBe('录入成绩')
  })

  test('builds share title with tournament name and status label', () => {
    expect(getTournamentShareTitle({ name: '五月排位赛', status: 'completed' })).toBe('五月排位赛 · 已结算')
    expect(getTournamentShareTitle(null)).toBe('FU OPEN 赛事')
  })
})
