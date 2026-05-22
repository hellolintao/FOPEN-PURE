const {
  canRegister,
  canWithdraw,
  isActiveRegistration
} = require('../../_shared/tournament-phase')

function ok(data) {
  return { success: true, data }
}

function fail(code, message) {
  return { success: false, error: { code, message: message || code } }
}

function payload(event = {}) {
  return { ...((event && event.data) || {}), ...(event || {}) }
}

function eventTournamentId(event = {}) {
  const p = payload(event)
  return p.tournamentId || p.id || p._id
}

function timestamp(ctx) {
  if (ctx && typeof ctx.serverDate === 'function') return ctx.serverDate()
  if (ctx && typeof ctx.now === 'function') return ctx.now()
  return new Date().toISOString()
}

function nowValue(ctx) {
  return ctx && typeof ctx.now === 'function' ? ctx.now() : new Date()
}

function tournamentIdPart(value) {
  const sanitized = String(value || '')
    .replace(/^tournament_/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return sanitized || 'unknown'
}

function buildRegistrationId(tournamentId, index) {
  const indexStr = Number(index || 0).toString().padStart(3, '0')
  return `reg_${tournamentIdPart(tournamentId)}_${indexStr}`
}

async function selfRegister(ctx, event = {}) {
  const tournamentId = eventTournamentId(event)
  if (!tournamentId) return fail('INVALID_ARG', 'tournamentId 不能为空')
  if (!ctx || typeof ctx.runTransaction !== 'function') return fail('INVALID_CTX', '缺少事务上下文')

  return ctx.runTransaction(async (tx) => {
    const tournament = await tx.getTournament(tournamentId)
    if (!tournament) return fail('NOT_FOUND', '赛事不存在')

    const member = await tx.getMemberByOpenid(ctx.openid)
    const memberError = validateCallerMember(ctx, member)
    if (memberError) return memberError
    if (isTournamentCreator(tournament, ctx, member)) {
      return fail('CREATOR_CANNOT_REGISTER', '发起人不能报名')
    }

    const registrations = await tx.listRegistrations(tournamentId)
    const memberRows = registrations.filter(row => isRegistrationForMember(row, member._id))
    if (memberRows.some(isActiveRegistration)) {
      return fail('ALREADY_REGISTERED', '已报名该赛事')
    }

    const activeCount = registrations.filter(isActiveRegistration).length
    const effectiveCount = getEffectiveConfirmedCount(tournament, activeCount)
    const registerable = canRegister(tournament, {
      now: nowValue(ctx),
      confirmedCount: effectiveCount
    })
    if (!registerable.ok) {
      return fail(registerable.code || 'REGISTRATION_CLOSED', registerable.code || '报名不可用')
    }

    const at = timestamp(ctx)
    const withdrew = memberRows.find(row => !isActiveRegistration(row))
    if (withdrew) {
      const upsertError = await upsertRegistrationOrFail(tx, withdrew._id, {
        tournamentId,
        seasonId: tournament.seasonId,
        type: tournament.type,
        playerId: member._id,
        playerName: member.name || '',
        partnerId: null,
        partnerName: null,
        teamName: null,
        registrationStatus: 'confirmed',
        source: withdrew.source || 'wechat',
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        reregisteredAt: at,
        updateTime: at
      })
      if (upsertError) return upsertError
      await tx.updateTournament(tournamentId, {
        confirmedCount: effectiveCount + 1,
        updateTime: at
      })
      return ok({ registrationId: withdrew._id, reused: true })
    }

    const registrationId = nextRegistrationId(tournamentId, registrations)
    const upsertError = await upsertRegistrationOrFail(tx, registrationId, {
      _id: registrationId,
      registrationId,
      tournamentId,
      seasonId: tournament.seasonId,
      type: tournament.type,
      playerId: member._id,
      playerName: member.name || '',
      playerAvatarUrl: member.avatarUrl || '',
      partnerId: null,
      partnerName: null,
      teamName: null,
      seed: activeCount + 1,
      registrationStatus: 'confirmed',
      source: 'wechat',
      registerTime: at,
      createTime: at,
      updateTime: at
    })
    if (upsertError) return upsertError
    await tx.updateTournament(tournamentId, {
      confirmedCount: effectiveCount + 1,
      updateTime: at
    })
    return ok({ registrationId, reused: false })
  })
}

async function withdrawRegistration(ctx, event = {}) {
  const p = payload(event)
  const tournamentId = eventTournamentId(event)
  if (!tournamentId) return fail('INVALID_ARG', 'tournamentId 不能为空')
  if (!ctx || typeof ctx.runTransaction !== 'function') return fail('INVALID_CTX', '缺少事务上下文')

  const txResult = await ctx.runTransaction(async (tx) => {
    const tournament = await tx.getTournament(tournamentId)
    if (!tournament) return fail('NOT_FOUND', '赛事不存在')

    const member = await tx.getMemberByOpenid(ctx.openid)
    const memberError = validateCallerMember(ctx, member)
    if (memberError) return memberError

    const registrations = await tx.listRegistrations(tournamentId)
    const activeRows = registrations
      .filter(row => isRegistrationForMember(row, member._id))
      .filter(isActiveRegistration)
    if (activeRows.length === 0) return fail('NOT_REGISTERED', '未报名该赛事')
    if (activeRows.length > 1) {
      return fail('DUPLICATE_ACTIVE_REGISTRATION', '存在重复有效报名，请联系管理员处理')
    }
    const activeRegistration = activeRows[0]

    if (!canWithdraw(tournament, { now: nowValue(ctx) })) {
      return fail('WITHDRAW_CLOSED', '退赛已截止')
    }

    let matchResults
    try {
      matchResults = await tx.listMatchResults(tournamentId)
    } catch (err) {
      return fail('MATCH_RESULTS_UNAVAILABLE', '比赛结果读取失败，请稍后重试')
    }
    const affectedResults = matchResults.filter(row => isAffectedMatch(row, activeRegistration))
    if (affectedResults.some(hasSubmittedScore)) {
      return fail('MATCH_HAS_RESULT', '已有比赛结果，不能退赛')
    }

    let brackets
    try {
      brackets = await tx.listBrackets(tournamentId)
    } catch (err) {
      return fail('BRACKETS_UNAVAILABLE', '赛程读取失败，请稍后重试')
    }
    const affectedBracketMatches = collectAffectedBracketMatches(brackets, activeRegistration)
    if (affectedBracketMatches.some(hasSubmittedScore)) {
      return fail('MATCH_HAS_RESULT', '已有比赛结果，不能退赛')
    }

    const scheduleNeedsRevision = isSchedulePublished(tournament) &&
      (affectedResults.length > 0 || affectedBracketMatches.length > 0)
    const bracketPatches = scheduleNeedsRevision
      ? buildBracketRevisionPatches(brackets, activeRegistration)
      : []
    const at = timestamp(ctx)
    const update = {
      registrationStatus: 'withdrew',
      cancelledAt: at,
      cancelledBy: member._id,
      updateTime: at
    }
    if (p.cancelReason !== undefined) {
      update.cancelReason = p.cancelReason || ''
    }

    await tx.updateRegistration(activeRegistration._id, update)

    const fallbackCount = registrations.filter(isActiveRegistration).length
    const currentCount = Number.isFinite(Number(tournament.confirmedCount))
      ? Number(tournament.confirmedCount)
      : fallbackCount
    const tournamentUpdate = {
      confirmedCount: Math.max(0, currentCount - 1),
      updateTime: at
    }
    if (scheduleNeedsRevision) tournamentUpdate.scheduleNeedsRevision = true
    await tx.updateTournament(tournamentId, tournamentUpdate)

    return {
      success: true,
      data: {
        registrationId: activeRegistration._id,
        scheduleNeedsRevision
      },
      _bracketPatches: bracketPatches,
      _timestamp: at
    }
  })

  if (txResult && txResult.success && txResult._bracketPatches && txResult._bracketPatches.length > 0) {
    try {
      await ctx.db.updateBracketMatches(tournamentId, txResult._bracketPatches, txResult._timestamp)
    } catch (err) {
      return {
        success: true,
        data: {
          ...txResult.data,
          bracketRevisionWarning: err && err.message ? err.message : 'BRACKET_REVISION_FAILED'
        }
      }
    }
  }

  if (txResult && txResult.success) return ok(txResult.data)
  return txResult
}

function validateCallerMember(ctx, member) {
  if (!member || !member._id || (!member.openid && !member.openId)) {
    return fail('MEMBER_REQUIRED', '请先认领会员身份')
  }
  if (member.claimStatus === 'pending' || member.claimStatus === 'unclaimed') {
    return fail('MEMBER_REQUIRED', '请先认领会员身份')
  }
  const memberOpenid = member.openid || member.openId
  if (ctx.openid && memberOpenid && memberOpenid !== ctx.openid) {
    return fail('PERMISSION_DENIED', '无权操作该会员')
  }
  return null
}

function isTournamentCreator(tournament, ctx, member) {
  if (!tournament || !member) return false
  const memberOpenid = member.openid || member.openId
  return !!(
    (tournament.createdBy && tournament.createdBy === member._id) ||
    (tournament.createdByOpenid && ctx.openid && tournament.createdByOpenid === ctx.openid) ||
    (tournament.createdByOpenid && memberOpenid && tournament.createdByOpenid === memberOpenid)
  )
}

function getEffectiveConfirmedCount(tournament = {}, activeCount) {
  const storedCount = numericOrNull(tournament.confirmedCount)
  return Math.max(storedCount === null ? activeCount : storedCount, activeCount)
}

function numericOrNull(value) {
  if (value === undefined || value === null || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function nextRegistrationId(tournamentId, registrations = []) {
  const used = new Set(
    (registrations || [])
      .map(row => parseRegistrationIndex(tournamentId, row && row._id))
      .filter(index => index > 0)
  )
  let index = 1
  while (used.has(index)) index += 1
  return buildRegistrationId(tournamentId, index)
}

function parseRegistrationIndex(tournamentId, registrationId) {
  const prefix = `reg_${tournamentIdPart(tournamentId)}_`
  if (typeof registrationId !== 'string' || !registrationId.startsWith(prefix)) return 0
  const suffix = registrationId.slice(prefix.length)
  if (!/^\d+$/.test(suffix)) return 0
  return Number(suffix)
}

async function upsertRegistrationOrFail(tx, id, data) {
  try {
    await tx.upsertRegistration(id, data)
    return null
  } catch (err) {
    return fail(err.code || 'REGISTRATION_WRITE_FAILED', err.message || '报名写入失败')
  }
}

function isRegistrationForMember(registration = {}, memberId) {
  return !!memberId && (
    registration.playerId === memberId ||
    registration.partnerId === memberId ||
    registration.memberId === memberId
  )
}

function isSchedulePublished(tournament = {}) {
  return tournament.scheduleStatus === 'published' || !!tournament.schedulePublishedAt
}

function hasSubmittedScore(match = {}) {
  const status = String(match.resultStatus || match.status || '').toLowerCase()
  return status === 'submitted' || status === 'confirmed' || status === 'settled'
}

function isAffectedMatch(match = {}, registration = {}) {
  const registrationIds = new Set([
    registration._id,
    registration.registrationId,
    registration.playerId,
    registration.partnerId,
    registration.memberId
  ].filter(Boolean))
  if (registrationIds.size === 0 || !match) return false

  const matchIds = new Set()
  ;(match.playerIds || []).forEach(id => addId(matchIds, id))
  ;(match.players || []).forEach(player => collectSideIds(matchIds, player))
  collectSideIds(matchIds, match.player1)
  collectSideIds(matchIds, match.player2)

  for (const id of matchIds) {
    if (registrationIds.has(id)) return true
  }
  return false
}

function collectSideIds(target, side) {
  if (!side) return
  addId(target, side.id)
  addId(target, side.playerId)
  addId(target, side.memberId)
  addId(target, side.registrationId)
  addId(target, side.partnerId)
}

function addId(target, id) {
  if (id) target.add(id)
}

function collectAffectedBracketMatches(brackets = [], registration) {
  const matches = []
  ;(brackets || []).forEach(bracket => {
    ;(bracket.matches || []).forEach(match => {
      if (isAffectedMatch(match, registration)) matches.push(match)
    })
  })
  return matches
}

function buildBracketRevisionPatches(brackets = [], registration) {
  return (brackets || [])
    .map(bracket => {
      let changed = false
      const matches = (bracket.matches || []).map(match => {
        if (!isAffectedMatch(match, registration)) return match
        changed = true
        return { ...match, needsRevision: true }
      })
      return changed ? { bracketId: bracket._id, matches } : null
    })
    .filter(Boolean)
}

module.exports = {
  buildRegistrationId,
  selfRegister,
  withdrawRegistration,
  isAffectedMatch,
  hasSubmittedScore
}
