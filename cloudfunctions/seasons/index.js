// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const collection = db.collection('seasons')

exports.main = async (event, context) => {
  const { action, data, page = 1, pageSize = 10, keyword, id } = event
  const now = db.serverDate()
  switch (action) {
    case 'add': {
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
      // 更新赛季
      return await collection.doc(id).update({
        data: {
          ...data,
          updateTime: now
        }
      })
    }
    case 'delete': {
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
    default:
      return { errMsg: 'invalid action' }
  }
}