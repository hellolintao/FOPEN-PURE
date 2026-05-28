// 云函数入口文件
const cloud = require('wx-server-sdk')
const { validateTournament } = require('./lib/validate')
const { isActiveRegistration } = require('../_shared/tournament-phase')
const { createScheduledMatchResultService } = require('../_shared/scheduled-match-results')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const collection = db.collection('tournaments')
const scheduledMatchResults = createScheduledMatchResultService({ db, command: _ })
const REGISTRATION_QUERY_CHUNK_SIZE = 20
const REGISTRATION_PAGE_SIZE = 1000
const REGISTRATION_MAX_PAGES_PER_CHUNK = 5

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateTournamentId() {
  const year = new Date().getFullYear()
  const timestamp = Date.now()
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `tournament_${year}_${timestamp.toString().slice(-6)}_${random}`
}

function normalizeTournamentPayload(data = {}) {
  const payload = { ...data }
  if (payload.format !== 'group_knockout') return payload

  const bracketSize = Number(payload.bracketSize || payload.maxPlayers || 16)
  return {
    ...payload,
    type: 'singles',
    bracketSize,
    maxPlayers: bracketSize,
    scheduleStatus: 'none',
    groupDrawMode: payload.groupDrawMode || 'onsite',
    groupKnockoutPhase: payload.groupKnockoutPhase || 'group_draft',
    groupRankSnapshot: payload.groupRankSnapshot ?? null,
    knockoutSeedSnapshot: payload.knockoutSeedSnapshot ?? null,
  }
}

function normalizeTournamentUpdatePatch(patch = {}, current = {}) {
  const format = patch.format || current.format
  if (format !== 'group_knockout') return normalizeTournamentPayload(patch)

  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(patch, key)
  return normalizeTournamentPayload({
    ...patch,
    format: 'group_knockout',
    bracketSize: hasOwn('bracketSize') ? patch.bracketSize : current.bracketSize,
    maxPlayers: hasOwn('maxPlayers') ? patch.maxPlayers : current.maxPlayers,
    groupDrawMode: hasOwn('groupDrawMode') ? patch.groupDrawMode : current.groupDrawMode,
    groupKnockoutPhase: hasOwn('groupKnockoutPhase') ? patch.groupKnockoutPhase : current.groupKnockoutPhase,
    groupRankSnapshot: hasOwn('groupRankSnapshot') ? patch.groupRankSnapshot : current.groupRankSnapshot,
    knockoutSeedSnapshot: hasOwn('knockoutSeedSnapshot') ? patch.knockoutSeedSnapshot : current.knockoutSeedSnapshot,
  })
}

/**
 * Build a standard success envelope.
 * @param {object} data
 * @returns {{ success: true, data: object }}
 */
function ok(data) {
  return { success: true, data }
}

/**
 * Build a standard error envelope.
 * @param {string} code
 * @param {string} message
 * @param {string[]} [errors]
 * @returns {{ success: false, error: object }}
 */
function fail(code, message, errors) {
  return {
    success: false,
    error: errors && errors.length ? { code, message, errors } : { code, message }
  }
}

function isAdminMember(member) {
  return !!(member && (member.admin === true || member.isAdmin === true))
}

async function resolveMemberByOpenid(openid, database = db, command = _) {
  if (!openid) return null
  const memberRes = await database.collection('members').where(command.or([
    { openid },
    { openId: openid }
  ])).get()
  const members = memberRes.data || []
  const member = members[0]
  if (!member) return null
  return { ...member, openid: member.openid || member.openId || openid }
}

// ---------------------------------------------------------------------------
// Action: create
// ---------------------------------------------------------------------------

async function actionCreate(event) {
  const data = normalizeTournamentPayload((event && event.data) || {})
  const status = data.status || 'upcoming'
  const isDraft = status === 'draft'

  const errors = validateTournament(data, { isDraft })
  if (errors.length > 0) {
    return fail('VALIDATION_ERROR', '数据校验失败', errors)
  }

  // Resolve creator
  let createdBy = null
  let createdByOpenid = null
  try {
    const wxContext = cloud.getWXContext()
    createdByOpenid = wxContext.OPENID || null
    if (createdByOpenid) {
      const member = await resolveMemberByOpenid(createdByOpenid)
      createdBy = member ? member._id : null
    }
  } catch (e) {
    console.error('获取创建者信息失败:', e)
  }

  const tournamentId = data._id || generateTournamentId()
  const now = db.serverDate()

  const doc = {
    _id: tournamentId,
    seasonId: data.seasonId || '',
    name: data.name,
    type: data.type,
    format: data.format || 'regular',
    startDate: data.startDate,
    endDate: data.endDate || '',
    location: data.location || '',
    status,
    description: data.description || '',
    ...(data.scheduleStatus !== undefined ? { scheduleStatus: data.scheduleStatus } : {}),
    schedulePlan: data.schedulePlan || null,
    maxPlayers: data.maxPlayers || null,
    ...(data.bracketSize !== undefined ? { bracketSize: data.bracketSize } : {}),
    ...(data.groupDrawMode !== undefined ? { groupDrawMode: data.groupDrawMode } : {}),
    ...(data.groupKnockoutPhase !== undefined ? { groupKnockoutPhase: data.groupKnockoutPhase } : {}),
    ...(data.groupRankSnapshot !== undefined ? { groupRankSnapshot: data.groupRankSnapshot } : {}),
    ...(data.knockoutSeedSnapshot !== undefined ? { knockoutSeedSnapshot: data.knockoutSeedSnapshot } : {}),
    pointsRules: data.pointsRules || null,
    // Legacy field — kept for backward compatibility with old pages until Task 14
    courtTimeGrid: data.courtTimeGrid || null,
    createdBy,
    createdByOpenid,
    createTime: now,
    updateTime: now
  }

  try {
    await collection.add({ data: doc })
    const { createdByOpenid: _omit, ...publicDoc } = doc
    return ok({ id: tournamentId, tournament: publicDoc })
  } catch (e) {
    console.error('create tournament failed:', e)
    return fail('DB_ERROR', '数据库写入失败')
  }
}

// ---------------------------------------------------------------------------
// Action: update (new envelope)
// ---------------------------------------------------------------------------

async function actionUpdate(event) {
  const { id } = event
  const data = (event && event.data) || {}
  if (!id) return fail('MISSING_ID', 'id 不能为空')

  const now = db.serverDate()

  // Fetch the current doc and merge with incoming data so partial updates
  // are validated against the full document state (spec: Phase 7 Task 2).
  const cur = await collection.doc(id).get().catch(() => null)
  if (!cur || !cur.data) return fail('NOT_FOUND', '赛事不存在')
  const updatePatch = normalizeTournamentUpdatePatch(data, cur.data)
  const merged = normalizeTournamentPayload({ ...cur.data, ...updatePatch })
  const isDraft = (updatePatch.status || merged.status) === 'draft'
  const errors = validateTournament(merged, { isDraft })
  if (errors.length > 0) {
    return fail('VALIDATION_ERROR', '数据校验失败', errors)
  }

  // 嵌套对象字段必须用 _.set() 包一层，否则 TCB 会把 { schedulePlan: {...} }
  // 展开成 dot-path 写入，遇到旧 doc 上 schedulePlan=null 时会报
  // "Cannot create field 'courts' in element {schedulePlan: null}"
  const updateData = { ...updatePatch, updateTime: now }
  if (updateData.schedulePlan !== undefined) {
    updateData.schedulePlan = _.set(updateData.schedulePlan)
  }
  if (updateData.pointsRules !== undefined) {
    updateData.pointsRules = _.set(updateData.pointsRules)
  }

  try {
    await collection.doc(id).update({ data: updateData })
    return ok({ id })
  } catch (e) {
    console.error('update tournament failed:', e)
    return fail('DB_ERROR', e && e.message ? e.message : '数据库更新失败')
  }
}

// ---------------------------------------------------------------------------
// Action: list
// ---------------------------------------------------------------------------

async function actionList(event) {
  const { page = 1, pageSize = 10, keyword, status, statusNot, createdBy, ids, data: extraData } = event

  // NOTE: Return shape is { success: true, data: { tournaments: [...], total: N } }
  // This replaces the old { data: [...] } shape.
  // The only existing caller (tournament-manage/index.js) has been updated to
  // read result.data.tournaments. New wizard pages can rely on result.data.tournaments.
  try {
    const query = []
    if (keyword) {
      query.push({ name: db.RegExp({ regexp: keyword, options: 'i' }) })
    }
    if (status) {
      query.push({ status })
    }
    if (statusNot) {
      query.push({ status: _.neq(statusNot) })
    }
    if (createdBy) {
      query.push({ createdBy })
    }
    if (ids && Array.isArray(ids) && ids.length > 0) {
      query.push({ _id: _.in(ids) })
    }
    if (extraData && extraData.type) {
      query.push({ type: extraData.type })
    }
    if (extraData && extraData.seasonId) {
      query.push({ seasonId: extraData.seasonId })
    }

    const whereClause = query.length ? _.and(query) : {}

    const [tournamentsRes, countRes] = await Promise.all([
      collection
        .where(whereClause)
        .orderBy('startDate', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get(),
      collection.where(whereClause).count()
    ])
    const tournaments = tournamentsRes.data || []
    const total = countRes.total || 0

    // Aggregate seasonName
    const seasonIds = [...new Set(tournaments.map(t => t.seasonId).filter(Boolean))]
    const seasonMap = seasonIds.length > 0
      ? await db.collection('seasons').where({ '_id': _.in(seasonIds) }).get().then(
          res => (res.data || []).reduce(
            (acc, s) => ({ ...acc, [s._id]: s.name }),
            {}
          )
        )
      : {}
    const enriched = tournaments.map(t => ({ ...t, seasonName: seasonMap[t.seasonId] || '-' }))

    return { success: true, data: { tournaments: enriched, total } }
  } catch (e) {
    console.error('[tournaments.list] error', e)
    return fail('INTERNAL', e.message)
  }
}

// ---------------------------------------------------------------------------
// Action: lastPointsRules
// ---------------------------------------------------------------------------

async function actionLastPointsRules(event) {
  const { format, type } = event
  const query = {
    status: 'completed',
    ...(format && { format }),
    ...(type && { type })
  }

  try {
    const res = await collection
      .where(query)
      .orderBy('startDate', 'desc')
      .limit(1)
      .get()
    const results = res.data || []
    if (results.length === 0) {
      return fail('NOT_FOUND', '未找到已完成的赛事')
    }
    return ok({ pointsRules: results[0].pointsRules || null })
  } catch (e) {
    console.error('lastPointsRules failed:', e)
    return fail('DB_ERROR', '数据库查询失败')
  }
}

// ---------------------------------------------------------------------------
// Admin console ctx builder
// ---------------------------------------------------------------------------

function buildAdminConsoleCtx(submitter) {
  return {
    isAdmin: submitter.isAdmin,
    callerOpenid: submitter.openid,
    callerMemberId: submitter._id,
    db: {
      aggregateSubmitted: async () => {
        const rows = (await db.collection('match_results')
          .where({ resultStatus: 'submitted' })
          .orderBy('updateTime', 'desc')
          .limit(200).get()).data
        const tIds = [...new Set(rows.map(r => r.tournamentId))]
        const tournaments = tIds.length
          ? (await db.collection('tournaments').where({ _id: _.in(tIds) }).get()).data
          : []
        const tMap = Object.fromEntries(tournaments.map(t => [t._id, t]))
        const grouped = {}
        for (const r of rows) {
          const k = r.tournamentId
          if (!grouped[k]) {
            grouped[k] = {
              tournamentId: k,
              tournamentName: (tMap[k] && tMap[k].name) || k,
              format: (tMap[k] && tMap[k].format) || 'regular',
              count: 0,
              mostRecentSubmitAt: r.submittedAt || r.updateTime || null,
            }
          }
          grouped[k].count += 1
          const cur = grouped[k].mostRecentSubmitAt
          const cmp = r.submittedAt || r.updateTime
          if (cmp && (!cur || new Date(cmp) > new Date(cur))) grouped[k].mostRecentSubmitAt = cmp
        }
        return Object.values(grouped)
      },
      listDrafts: async (memberId) => (await db.collection('tournaments').where({
        status: 'draft',
        createdBy: memberId,
      }).orderBy('updateTime', 'desc').limit(20).get()).data.map(t => ({
        tournamentId: t._id,
        name: t.name,
        playerCount: t.playerCount || 0,
        scheduleReady: !!(t.schedulePlan && t.schedulePlan.courts && t.schedulePlan.courts.length),
        updatedAt: t.updateTime,
      })),
      listOngoing: async () => {
        const rows = (await db.collection('tournaments').where({ status: 'ongoing' })
          .orderBy('updateTime', 'desc').limit(50).get()).data
        return rows.map(t => ({
          tournamentId: t._id,
          name: t.name,
          format: t.format,
          round: t.currentRoundLabel || '',
          remainingMatches: t.remainingMatches || 0,
        }))
      },
      listWorkbenchTournaments: async () => (await db.collection('tournaments')
        .orderBy('updateTime', 'desc')
        .limit(100)
        .get()).data,
      listRegistrations: async (tournamentId) => listTournamentRegistrations(tournamentId),
      countActiveRegistrationsByTournamentIds: async (tournamentIds) => countActiveRegistrationsByTournamentIds(tournamentIds),
      countConfirmedRegistrations: async (tournamentId) => countActiveRegistrations(tournamentId),
      countScheduleRevisionAffected: async (tournamentId) => {
        const res = await db.collection('tournament_brackets')
          .where({ tournamentId })
          .limit(20)
          .get()
        return (res.data || []).reduce((sum, bracket) => {
          const matches = Array.isArray(bracket.matches) ? bracket.matches : []
          return sum + matches.filter(match => match && match.needsRevision).length
        }, 0)
      },
    },
  }
}

async function buildBulkUpsertSchedulePayload(tournamentId, schedulePlan = {}) {
  const queues = Array.isArray(schedulePlan && schedulePlan.queues) ? schedulePlan.queues : []
  let matches = Array.isArray(schedulePlan && schedulePlan.matches) ? schedulePlan.matches : null

  if (!matches) {
    const bracketId = `bracket_${tournamentId.replace('tournament_', '')}_round_1`
    const res = await db.collection('tournament_brackets').doc(bracketId).get().catch(() => null)
    matches = res && res.data && Array.isArray(res.data.matches) ? res.data.matches : []
  }

  if (!Array.isArray(matches) || matches.length === 0) {
    return {
      success: false,
      error: {
        code: 'MISSING_MATCHES',
        message: '排程缺少对阵，请先生成并保存对阵'
      }
    }
  }

  return { success: true, data: { matches, queues } }
}

function buildRegistrationPhaseCtx(member) {
  return {
    isAdmin: isAdminMember(member),
    callerOpenid: member.openid,
    callerMemberId: member._id,
    now: () => new Date().toISOString(),
    serverDate: () => db.serverDate(),
    db: {
      getTournament: async (tournamentId) => {
        const res = await collection.doc(tournamentId).get().catch(() => null)
        return res && res.data
      },
      countConfirmedRegistrations: async (tournamentId) => countActiveRegistrations(tournamentId),
      updateTournament: async (tournamentId, data) => {
        const updateData = { ...data }
        if (updateData.schedulePlan !== undefined) {
          updateData.schedulePlan = _.set(updateData.schedulePlan)
        }
        await collection.doc(tournamentId).update({ data: updateData })
      },
      bulkUpsertScheduledMatches: async (tournamentId, schedulePlan) => {
        const payload = await buildBulkUpsertSchedulePayload(tournamentId, schedulePlan)
        if (!payload.success) return payload
        return scheduledMatchResults.upsertScheduledMatches({
          tournamentId,
          matches: payload.data.matches,
          queues: payload.data.queues
        })
      }
    }
  }
}

async function listTournamentRegistrations(tournamentId) {
  const res = await db.collection('tournament_registrations')
    .where({ tournamentId })
    .limit(1000)
    .get()
  return (res && res.data) || []
}

async function countActiveRegistrations(tournamentId) {
  const counts = await countActiveRegistrationsByTournamentIds([tournamentId])
  return counts[tournamentId] || 0
}

async function countActiveRegistrationsByTournamentIds(tournamentIds) {
  const ids = [...new Set((tournamentIds || []).filter(Boolean))]
  const counts = Object.fromEntries(ids.map(id => [id, 0]))
  if (ids.length === 0) return counts

  for (const chunk of chunkArray(ids, REGISTRATION_QUERY_CHUNK_SIZE)) {
    for (let page = 0; page < REGISTRATION_MAX_PAGES_PER_CHUNK; page += 1) {
      let query = db.collection('tournament_registrations').where({ tournamentId: _.in(chunk) })
      const canSkip = typeof query.skip === 'function'
      if (canSkip) query = query.skip(page * REGISTRATION_PAGE_SIZE)
      if (typeof query.limit === 'function') query = query.limit(REGISTRATION_PAGE_SIZE)
      const res = await query.get()
      const rows = (res && res.data) || []
      rows.forEach(row => {
        if (row && counts[row.tournamentId] !== undefined && isActiveRegistration(row)) {
          counts[row.tournamentId] += 1
        }
      })
      if (rows.length < REGISTRATION_PAGE_SIZE || !canSkip) break
    }
  }

  return counts
}

function chunkArray(values, size) {
  const chunks = []
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size))
  }
  return chunks
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

exports.main = async (event, context) => {
  const { action, data, page = 1, pageSize = 10, keyword, id, status, _id } = event
  const now = db.serverDate()

  switch (action) {
    // ── Legacy action: keep old contract so tournament-edit still works ──
    case 'add': {
      // Old callers read res.result._id or res.result.data._id, and check errMsg
      const normalizedData = normalizeTournamentPayload(data || {})
      const errors = validateTournament(normalizedData)
      if (errors.length > 0) {
        return { errMsg: 'validation failed', errors }
      }
      const tournamentId = (normalizedData && normalizedData._id) || generateTournamentId()
      const addData = {
        _id: tournamentId,
        seasonId: (normalizedData && normalizedData.seasonId) || '',
        name: normalizedData.name,
        type: normalizedData.type,
        format: (normalizedData && normalizedData.format) || 'regular',
        startDate: normalizedData.startDate,
        endDate: (normalizedData && normalizedData.endDate) || '',
        location: (normalizedData && normalizedData.location) || '',
        status: (normalizedData && normalizedData.status) || 'upcoming',
        description: (normalizedData && normalizedData.description) || '',
        ...(normalizedData.scheduleStatus !== undefined ? { scheduleStatus: normalizedData.scheduleStatus } : {}),
        ...(normalizedData.bracketSize !== undefined ? { bracketSize: normalizedData.bracketSize } : {}),
        ...(normalizedData.groupDrawMode !== undefined ? { groupDrawMode: normalizedData.groupDrawMode } : {}),
        ...(normalizedData.groupKnockoutPhase !== undefined ? { groupKnockoutPhase: normalizedData.groupKnockoutPhase } : {}),
        ...(normalizedData.groupRankSnapshot !== undefined ? { groupRankSnapshot: normalizedData.groupRankSnapshot } : {}),
        ...(normalizedData.knockoutSeedSnapshot !== undefined ? { knockoutSeedSnapshot: normalizedData.knockoutSeedSnapshot } : {}),
        maxPlayers: normalizedData.maxPlayers || null,
        config: (normalizedData && normalizedData.config) || {
          maxPlayers: 16,
          currentRound: 1,
          totalRounds: 4,
          playersPerMatch: 2,
          eliminationType: 'single',
          seedPlayers: []
        },
        pointsRules: (normalizedData && normalizedData.pointsRules) || {
          win: 100,
          loss: 20,
          walkover: 50,
          bonusByRound: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
        },
        courtTimeGrid: (normalizedData && normalizedData.courtTimeGrid) || null,
        createTime: now,
        updateTime: now
      }
      return collection.add({ data: addData })
    }

    // ── New action: create (Phase 7 wizard) ──
    case 'create':
      return actionCreate(event)

    case 'get':
      return collection.doc(id).get()

    // ── Legacy action: keep old errMsg contract so tournament-edit still works ──
    case 'update': {
      const normalizedData = normalizeTournamentPayload(data || {})
      const errors = validateTournament(normalizedData)
      if (errors.length > 0) {
        return { errMsg: 'validation failed', errors }
      }
      const updateData = { ...normalizedData, updateTime: now }
      return collection.doc(id).update({ data: updateData })
    }

    // ── New action: update with envelope (for new wizard pages) ──
    case 'updateNew':
      return actionUpdate(event)

    case 'updateConfig':
      return collection.doc(id).update({ data: { config: data.config, updateTime: now } })

    case 'updatePointsRules':
      return collection.doc(id).update({ data: { pointsRules: data.pointsRules, updateTime: now } })

    case 'updateStatus':
      return collection.doc(_id || id).update({ data: { status, updateTime: now } })

    case 'delete':
      return collection.doc(_id || id).remove()

    case 'list':
      return actionList(event)

    case 'lastPointsRules':
      return actionLastPointsRules(event)

    case 'publishRegistration':
    case 'saveScheduleDraft':
    case 'publishSchedule':
    case 'confirmScheduleRevision': {
      try {
        const wxContext = cloud.getWXContext()
        const openid = wxContext.OPENID || null
        if (!openid) return fail('FORBIDDEN', '需要登录')
        const member = await resolveMemberByOpenid(openid)
        if (!member) return fail('FORBIDDEN', '成员不存在')
        if (!isAdminMember(member)) return fail('FORBIDDEN', '需要管理员权限')
        const handlers = require('./lib/handlers/registration-phase')
        return handlers[action](buildRegistrationPhaseCtx(member), event)
      } catch (e) {
        return fail(e.code || 'INTERNAL', e.message || '操作失败')
      }
    }

    case 'adminConsoleSnapshot': {
      const { adminConsoleSnapshot } = require('./lib/handlers/admin-console')
      try {
        const wxContext = cloud.getWXContext()
        const openid = wxContext.OPENID || null
        if (!openid) return fail('FORBIDDEN', '需要登录')
        const member = await resolveMemberByOpenid(openid)
        if (!member) return fail('FORBIDDEN', '成员不存在')
        if (!isAdminMember(member)) return fail('FORBIDDEN', '需要管理员权限')
        const ctx = buildAdminConsoleCtx({ isAdmin: true, openid: member.openid, _id: member._id })
        const data = await Promise.race([
          adminConsoleSnapshot(ctx, event),
          new Promise((_, rej) => setTimeout(() => {
            const err = new Error('SNAPSHOT_TIMEOUT'); err.code = 'SNAPSHOT_TIMEOUT'; rej(err)
          }, 8000)),
        ])
        return ok(data)
      } catch (e) {
        return fail(e.code || 'INTERNAL', e.message)
      }
    }

    case 'finishedRecent': {
      const { finishedRecent } = require('./lib/handlers/finished-recent')
      try {
        const wxContext = cloud.getWXContext()
        const openid = wxContext.OPENID || null
        if (!openid) return fail('FORBIDDEN', '需要登录')
        const member = await resolveMemberByOpenid(openid)
        if (!member) return fail('FORBIDDEN', '成员不存在')
        if (!isAdminMember(member)) return fail('FORBIDDEN', '需要管理员权限')
        const ctx = {
          isAdmin: true,
          db: {
            listFinished: async (limit) => (await db.collection('tournaments').where({ status: 'completed' })
              .orderBy('completedAt', 'desc').limit(limit).get()).data,
          },
        }
        const result = await finishedRecent(ctx, event)
        return ok(result)
      } catch (e) {
        return fail(e.code || 'INTERNAL', e.message)
      }
    }

    case 'getStats': {
      const totalCount = await collection.count()
      const upcomingCount = await collection.where({ status: 'upcoming' }).count()
      const ongoingCount = await collection.where({ status: 'ongoing' }).count()
      const completedCount = await collection.where({ status: 'completed' }).count()
      return {
        data: {
          total: totalCount.total,
          upcoming: upcomingCount.total,
          ongoing: ongoingCount.total,
          completed: completedCount.total
        }
      }
    }

    default:
      return { errMsg: 'invalid action' }
  }
}

exports.__test__ = {
  resolveMemberByOpenid,
  isAdminMember,
  validateTournament,
  normalizeTournamentPayload,
  buildRegistrationPhaseCtx,
}
