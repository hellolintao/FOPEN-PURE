// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()
const _ = db.command
const collection = db.collection('members')

exports.main = async (event, context) => {
  const { action, data, page = 1, pageSize = 10, keyword } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  switch (action) {
    case 'add': {
      // 新增会员，openid 唯一
      const exist = await collection.where({ openid }).get()
      if (exist.data && exist.data.length > 0) {
        return { errMsg: 'already registered', data: exist.data[0] }
      }
      data.openid = openid
      data.registerTime = db.serverDate()
      data.winRate = 0
      data.score = 0
      return await collection.add({ data })
    }
    case 'search': {
      // 查询会员，支持 openid 精确查找，或姓名/手机号模糊，分页
      if (event.byOpenid) {
        return await collection.where({ openid }).get()
      }
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
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
    }
    case 'update':
      // 修改会员
      return await collection.doc(data._id).update({ data })
    case 'delete':
      // 删除会员
      return await collection.doc(data._id).remove()
    default:
      return { errMsg: 'invalid action' }
  }
}
