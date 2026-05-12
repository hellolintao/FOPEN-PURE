// 云函数入口文件
const cloud = require('wx-server-sdk')
const { validateMemberData } = require('./lib/validate')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const collection = db.collection('members')

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action, data, page = 1, pageSize = 10, keyword, _id } = event

  switch (action) {
    case 'add': {
      // 新增会员，openid唯一
      const v = validateMemberData(data || {})
      if (!v.valid) {
        return { success: false, error: { code: 'VALIDATION_FAILED', message: v.errors.join('; ') } }
      }
      const exist = await collection.where({ openid }).get()
      if (exist.data && exist.data.length > 0) {
        return { errMsg: 'already registered', data: exist.data[0] }
      }
      const now = db.serverDate()
      return await collection.add({
        data: {
          openid,
          name: data.name,
          avatarUrl: data.avatarUrl,
          phone: data.phone || '',
          status: data.status || 'active',
          admin: data.admin || false,
          playStyle: data.playStyle || '',
          playStyleNote: data.playStyleNote || '',
          createTime: now,
          updateTime: now
        }
      })
    }
    case 'get': {
      // 获取会员信息 by openid
      return await collection.where({ openid }).get()
    }
    case 'update': {
      // 更新会员信息 by openid
      const v = validateMemberData(data || {})
      if (!v.valid) {
        return { success: false, error: { code: 'VALIDATION_FAILED', message: v.errors.join('; ') } }
      }
      const now = db.serverDate()
      return await collection.where({ openid }).update({
        data: {
          ...data,
          updateTime: now
        }
      })
    }
    case 'delete': {
      // 删除会员 by openid
      return await collection.where({ openid }).remove()
    }
    case 'search': {
      // 支持按姓名或手机号模糊搜索，分页
      const query = []
      if (keyword) {
        query.push(
          _.or([
            { name: db.RegExp({ regexp: keyword, options: 'i' }) },
            { phone: db.RegExp({ regexp: keyword, options: 'i' }) }
          ])
        )
      }
      return await collection
        .where(query.length ? _.and(query) : {})
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
    }
    case 'list': {
      // 获取会员列表，支持状态过滤和分页
      const query = []
      if (data && data.status) {
        query.push({ status: data.status })
      }
      return await collection
        .where(query.length ? _.and(query) : {})
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
    }
    case 'updateById': {
      // 根据_id更新会员信息
      if (!_id) {
        return { errMsg: '_id is required' }
      }
      const v = validateMemberData(data || {})
      if (!v.valid) {
        return { success: false, error: { code: 'VALIDATION_FAILED', message: v.errors.join('; ') } }
      }
      const now = db.serverDate()
      return await collection.doc(_id).update({
        data: {
          ...data,
          updateTime: now
        }
      })
    }
    case 'deleteById': {
      // 根据_id删除会员
      if (!_id) {
        return { errMsg: '_id is required' }
      }
      return await collection.doc(_id).remove()
    }
    default:
      return { errMsg: 'invalid action' }
  }
}