// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const collection = db.collection('tournaments')

exports.main = async (event, context) => {
  const { action, data, page = 1, pageSize = 10, keyword, id, status, _id } = event
  const now = db.serverDate()
  switch (action) {
    case 'add': {
      // 新增赛事
      return await collection.add({
        data: {
          _id: data._id,
          seasonId: data.seasonId,
          name: data.name,
          startDate: data.startDate,
          endDate: data.endDate,
          location: data.location,
          type: data.type,
          status: data.status || 'upcoming',
          description: data.description || '',
          createTime: now,
          updateTime: now
        }
      })
    }
    case 'get': {
      // 获取单个赛事
      return await collection.doc(id).get()
    }
    case 'update': {
      // 更新赛事
      return await collection.doc(id).update({
        data: {
          ...data,
          updateTime: now
        }
      })
    }
    case 'updateStatus': {
      // 更新赛事状态
      return await collection.doc(_id || id).update({
        data: {
          status,
          updateTime: now
        }
      })
    }
    case 'delete': {
      // 删除赛事
      return await collection.doc(_id || id).remove()
    }
    case 'list': {
      // 分页查询赛事，支持按名称模糊搜索，并聚合赛季名称
      const query = []
      if (keyword) {
        query.push({ name: db.RegExp({ regexp: keyword, options: 'i' }) })
      }
      // 查询赛事列表
      const tournamentsRes = await collection
        .where(query.length ? _.and(query) : {})
        .orderBy('startDate', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
      const tournaments = tournamentsRes.data || []
      // 获取所有涉及的seasonId
      const seasonIds = [...new Set(tournaments.map(t => t.seasonId).filter(Boolean))]
      let seasonMap = {}
      if (seasonIds.length > 0) {
        console.log('seasonIds', seasonIds)
        const seasonsRes = await db.collection('seasons').where({ '_id': _.in(seasonIds) }).get();
        (seasonsRes.data || []).forEach(s => { seasonMap[s['_id']] = s.name })
      }
      // 聚合seasonName
      const result = tournaments.map(t => ({
        ...t,
        seasonName: seasonMap[t.seasonId] || '-'
      }))
      return { data: result }
    }
    default:
      return { errMsg: 'invalid action' }
  }
}