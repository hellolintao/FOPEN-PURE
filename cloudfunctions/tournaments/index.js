// 云函数入口文件
const cloud = require('wx-server-sdk')
const { validateCourtTimeGrid, validateSchedulePlan, validatePointsRules } = require('./lib/validate')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const collection = db.collection('tournaments')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateTournamentId() {
  const year = new Date().getFullYear()
  const timestamp = Date.now()
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `tournament_${year}_${timestamp.toString().slice(-6)}_${random}`
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

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate tournament payload.
 * isDraft=true: only require minimal fields (name/type/format/startDate/seasonId).
 * isDraft=false: full validation including schedulePlan and pointsRules.
 * @param {object} data
 * @param {{ isDraft: boolean }} opts
 * @returns {string[]} errors array (empty = valid)
 */
function validateTournament(data, { isDraft = false } = {}) {
  const errors = []

  // Always-required fields
  if (!data.name || data.name.trim() === '') errors.push('赛事名称不能为空')
  if (!data.type || !['singles', 'doubles'].includes(data.type)) {
    errors.push('赛事类型必须是 singles 或 doubles')
  }
  if (!data.format || !['regular', 'knockout'].includes(data.format)) {
    errors.push('赛制必须是 regular(常规赛) 或 knockout(淘汰赛)')
  }
  if (!data.startDate) errors.push('开始日期不能为空')
  if (!data.seasonId) errors.push('所属赛季不能为空')

  // Date range check (both fields present)
  if (data.startDate && data.endDate) {
    const start = new Date(data.startDate)
    const end = new Date(data.endDate)
    if (start > end) errors.push('结束日期不能早于开始日期')
  }

  if (isDraft) return errors

  // Full validation
  const spErrors = validateSchedulePlan(data.schedulePlan)
  errors.push(...spErrors)

  const prErrors = validatePointsRules(data.pointsRules)
  errors.push(...prErrors)

  if (data.format === 'knockout') {
    const max = data.maxPlayers
    if (!max || max < 2) errors.push('淘汰赛 maxPlayers 不能小于 2')
  }

  return errors
}

// ---------------------------------------------------------------------------
// Action: create
// ---------------------------------------------------------------------------

async function actionCreate(event) {
  const { data = {} } = event
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
      const memberRes = await db.collection('members')
        .where({ openid: createdByOpenid })
        .get()
      const members = memberRes.data || []
      createdBy = members.length > 0 ? members[0]._id : null
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
    schedulePlan: data.schedulePlan || null,
    maxPlayers: data.maxPlayers || null,
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
    return ok({ id: tournamentId, tournament: doc })
  } catch (e) {
    console.error('create tournament failed:', e)
    return fail('DB_ERROR', '数据库写入失败')
  }
}

// ---------------------------------------------------------------------------
// Action: update (new envelope)
// ---------------------------------------------------------------------------

async function actionUpdate(event) {
  const { id, data = {} } = event
  if (!id) return fail('MISSING_ID', 'id 不能为空')

  const now = db.serverDate()

  // Determine isDraft from existing status or incoming status
  const status = data.status
  const isDraft = status === 'draft'
  const errors = validateTournament(data, { isDraft })
  if (errors.length > 0) {
    return fail('VALIDATION_ERROR', '数据校验失败', errors)
  }

  const updateData = { ...data, updateTime: now }

  try {
    await collection.doc(id).update({ data: updateData })
    return ok({ id })
  } catch (e) {
    console.error('update tournament failed:', e)
    return fail('DB_ERROR', '数据库更新失败')
  }
}

// ---------------------------------------------------------------------------
// Action: list
// ---------------------------------------------------------------------------

async function actionList(event) {
  const { page = 1, pageSize = 10, keyword, status, statusNot, createdBy, ids, data: extraData } = event

  // NOTE: Return shape is { success: true, data: { tournaments: [...] } }
  // This replaces the old { data: [...] } shape.
  // The only existing caller (tournament-manage/index.js) has been updated to
  // read result.data.tournaments. New wizard pages can rely on result.data.tournaments.
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

  const tournamentsRes = await collection
    .where(query.length ? _.and(query) : {})
    .orderBy('startDate', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()
  const tournaments = tournamentsRes.data || []

  // Aggregate seasonName
  const seasonIds = [...new Set(tournaments.map(t => t.seasonId).filter(Boolean))]
  let seasonMap = {}
  if (seasonIds.length > 0) {
    const seasonsRes = await db.collection('seasons').where({ '_id': _.in(seasonIds) }).get()
    ;(seasonsRes.data || []).forEach(s => { seasonMap[s['_id']] = s.name })
  }
  const enriched = tournaments.map(t => ({ ...t, seasonName: seasonMap[t.seasonId] || '-' }))

  return { success: true, data: { tournaments: enriched } }
}

// ---------------------------------------------------------------------------
// Action: lastPointsRules
// ---------------------------------------------------------------------------

async function actionLastPointsRules(event) {
  const { format, type } = event
  const query = { status: 'completed' }
  if (format) query.format = format
  if (type) query.type = type

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
// Main entry
// ---------------------------------------------------------------------------

exports.main = async (event, context) => {
  const { action, data, page = 1, pageSize = 10, keyword, id, status, _id } = event
  const now = db.serverDate()

  switch (action) {
    // ── Legacy action: keep old contract so tournament-edit still works ──
    case 'add': {
      // Old callers read res.result._id or res.result.data._id, and check errMsg
      const errors = validateTournament(data || {})
      if (errors.length > 0) {
        return { errMsg: 'validation failed', errors }
      }
      const tournamentId = (data && data._id) || generateTournamentId()
      const addData = {
        _id: tournamentId,
        seasonId: (data && data.seasonId) || '',
        name: data.name,
        type: data.type,
        format: (data && data.format) || 'regular',
        startDate: data.startDate,
        endDate: (data && data.endDate) || '',
        location: (data && data.location) || '',
        status: (data && data.status) || 'upcoming',
        description: (data && data.description) || '',
        config: (data && data.config) || {
          maxPlayers: 16,
          currentRound: 1,
          totalRounds: 4,
          playersPerMatch: 2,
          eliminationType: 'single',
          seedPlayers: []
        },
        pointsRules: (data && data.pointsRules) || {
          win: 100,
          loss: 20,
          walkover: 50,
          bonusByRound: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
        },
        courtTimeGrid: (data && data.courtTimeGrid) || null,
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
      const errors = validateTournament(data || {})
      if (errors.length > 0) {
        return { errMsg: 'validation failed', errors }
      }
      const updateData = { ...(data || {}), updateTime: now }
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
