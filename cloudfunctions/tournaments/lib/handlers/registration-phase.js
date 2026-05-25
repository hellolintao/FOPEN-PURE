function ok(data) {
  return { success: true, data }
}

function fail(code, message) {
  return { success: false, error: { code, message } }
}

function payload(event = {}) {
  return { ...((event && event.data) || {}), ...(event || {}) }
}

function eventId(event) {
  const p = payload(event)
  return p.id || p.tournamentId || p._id
}

function now(ctx) {
  return ctx.now ? ctx.now() : new Date().toISOString()
}

function updateTime(ctx, fallback) {
  return ctx.serverDate ? ctx.serverDate() : fallback
}

function isFutureDeadline(deadline, current) {
  const deadlineTime = new Date(deadline).getTime()
  const currentTime = new Date(current).getTime()
  return Number.isFinite(deadlineTime) &&
    Number.isFinite(currentTime) &&
    deadlineTime > currentTime
}

async function publishRegistration(ctx, event) {
  try {
    if (!ctx.isAdmin) return fail('FORBIDDEN', '需要管理员权限')
    const p = payload(event)
    const id = eventId(event)
    if (!id) return fail('MISSING_ID', 'id 不能为空')

    const publishedAt = now(ctx)
    const deadline = p.registrationDeadlineAt
    if (!deadline || !isFutureDeadline(deadline, publishedAt)) {
      return fail('INVALID_DEADLINE', '报名截止必须晚于当前时间')
    }

    const tournament = await ctx.db.getTournament(id)
    if (!tournament) return fail('NOT_FOUND', '赛事不存在')

    const confirmedCount = await ctx.db.countConfirmedRegistrations(id)
    await ctx.db.updateTournament(id, {
      registrationDeadlineAt: deadline,
      registrationPublishedAt: publishedAt,
      scheduleStatus: 'none',
      schedulePublishedAt: null,
      scheduleNeedsRevision: false,
      confirmedCount,
      updateTime: updateTime(ctx, publishedAt)
    })
    return ok({ id, confirmedCount })
  } catch (e) {
    return fail(e.code || 'INTERNAL', e.message || '发布报名失败')
  }
}

async function saveScheduleDraft(ctx, event) {
  try {
    if (!ctx.isAdmin) return fail('FORBIDDEN', '需要管理员权限')
    const p = payload(event)
    const id = eventId(event)
    if (!id) return fail('MISSING_ID', 'id 不能为空')

    const savedAt = now(ctx)
    const data = {
      scheduleStatus: 'draft',
      updateTime: updateTime(ctx, savedAt)
    }
    if (p.schedulePlan !== undefined) data.schedulePlan = p.schedulePlan

    await ctx.db.updateTournament(id, data)
    return ok({ id })
  } catch (e) {
    return fail(e.code || 'INTERNAL', e.message || '保存赛程草稿失败')
  }
}

async function publishSchedule(ctx, event) {
  try {
    if (!ctx.isAdmin) return fail('FORBIDDEN', '需要管理员权限')
    const id = eventId(event)
    if (!id) return fail('MISSING_ID', 'id 不能为空')

    const tournament = await ctx.db.getTournament(id)
    if (!tournament) return fail('NOT_FOUND', '赛事不存在')
    if (
      !tournament.schedulePlan ||
      !Array.isArray(tournament.schedulePlan.courts) ||
      tournament.schedulePlan.courts.length === 0
    ) {
      return fail('EMPTY_SCHEDULE', '排程为空，请先在第 3 步排好场次')
    }

    let bulk
    try {
      bulk = await ctx.db.bulkUpsertScheduledMatches(id, tournament.schedulePlan)
    } catch (e) {
      return fail('BULK_UPSERT_FAILED', e.message || '生成录分行失败')
    }
    if (!bulk || bulk.success === false) {
      return fail(
        'BULK_UPSERT_FAILED',
        (bulk && bulk.error && bulk.error.message) || '生成录分行失败'
      )
    }

    const publishedAt = now(ctx)
    await ctx.db.updateTournament(id, {
      scheduleStatus: 'published',
      schedulePublishedAt: publishedAt,
      status: 'upcoming',
      scheduleNeedsRevision: false,
      updateTime: updateTime(ctx, publishedAt)
    })
    return ok({ id })
  } catch (e) {
    return fail(e.code || 'INTERNAL', e.message || '发布赛程失败')
  }
}

async function confirmScheduleRevision(ctx, event) {
  try {
    if (!ctx.isAdmin) return fail('FORBIDDEN', '需要管理员权限')
    const id = eventId(event)
    if (!id) return fail('MISSING_ID', 'id 不能为空')

    const confirmedAt = now(ctx)
    await ctx.db.updateTournament(id, {
      scheduleNeedsRevision: false,
      updateTime: updateTime(ctx, confirmedAt)
    })
    return ok({ id })
  } catch (e) {
    return fail(e.code || 'INTERNAL', e.message || '确认赛程调整失败')
  }
}

module.exports = {
  publishRegistration,
  saveScheduleDraft,
  publishSchedule,
  confirmScheduleRevision
}
