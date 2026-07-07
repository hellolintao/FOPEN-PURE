// 云函数入口文件
const cloud = require('wx-server-sdk')
const { selectCurrentSeason } = require('./lib/current')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const collection = db.collection('seasons')

function fail(code, message) {
  return { success: false, error: { code, message } }
}

function isAdminMember(member) {
  return !!(member && (member.admin === true || member.isAdmin === true))
}

async function resolveMemberByOpenid(openid, database = db, command = _) {
  if (!openid) return null
  const query = command && typeof command.or === 'function'
    ? command.or([{ openid }, { openId: openid }])
    : { openid }
  const res = await database.collection('members').where(query).get().catch(() => ({ data: [] }))
  const member = (res.data || [])[0]
  return member ? { ...member, openid: member.openid || member.openId || openid } : null
}

async function requireAdmin() {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID
  if (!openid) return fail('FORBIDDEN', '需要登录')
  const member = await resolveMemberByOpenid(openid)
  if (!isAdminMember(member)) return fail('FORBIDDEN', '需要管理员权限')
  return null
}

function getShanghaiDate(now = new Date()) {
  const date = new Date(now)
  const shanghaiTime = date.getTime() + 8 * 60 * 60 * 1000
  return new Date(shanghaiTime).toISOString().slice(0, 10)
}

async function getCurrentSeason(event, options = {}) {
  const data = event && event.data
  const today = options.today || (() => getShanghaiDate(options.now || new Date()))
  const seasonCollection = options.collection || collection
  const selector = options.selectCurrentSeason || selectCurrentSeason
  const targetDate = (event && event.date) || (data && data.date) || today()
  const result = await seasonCollection
    .where({})
    .orderBy('startDate', 'desc')
    .limit(100)
    .get()
  const season = selector(result.data || [], targetDate)
  if (!season) {
    return { success: false, error: { code: 'NOT_FOUND', message: '未找到当前赛季' } }
  }
  return {
    success: true,
    data: {
      season,
      seasonId: season._id,
      name: season.name
    }
  }
}

exports.main = async (event, context) => {
  const { action, data, page = 1, pageSize = 10, keyword, id } = event
  const now = db.serverDate()
  switch (action) {
    case 'add': {
      const adminGate = await requireAdmin()
      if (adminGate) return adminGate

      // 新增赛季
      return await collection.add({
        data: {
          _id: data._id,
          name: data.name,
          startDate: data.startDate,
          endDate: data.endDate,
          status: data.status || 'active',
          tournaments: data.tournaments || [],
          createTime: now,
          updateTime: now
        }
      })
    }
    case 'get': {
      // 获取单个赛季
      return await collection.doc(id).get()
    }
    case 'update': {
      const adminGate = await requireAdmin()
      if (adminGate) return adminGate

      // 更新赛季
      return await collection.doc(id).update({
        data: {
          ...data,
          updateTime: now
        }
      })
    }
    case 'delete': {
      const adminGate = await requireAdmin()
      if (adminGate) return adminGate

      // 删除赛季
      return await collection.doc(id).remove()
    }
    case 'list': {
      // 分页查询赛季，支持按名称模糊搜索
      const query = []
      if (keyword) {
        query.push({ name: db.RegExp({ regexp: keyword, options: 'i' }) })
      }
      return await collection
        .where(query.length ? _.and(query) : {})
        .orderBy('startDate', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
    }
    case 'getCurrent': {
      return await getCurrentSeason(event)
    }
    default:
      return { errMsg: 'invalid action' }
  }
}

exports.__test__ = { getCurrentSeason, getShanghaiDate, isAdminMember, resolveMemberByOpenid }
