/**
 * 迁移脚本 001：给老数据补默认值
 *
 * 用法：
 *  1) 在微信开发者工具云开发控制台 → 数据库 → 选择对应集合 → 高级 → 直接复制此脚本到云函数执行
 *  或
 *  2) 临时把此文件改名 index.js 放进新的 migration-runner 云函数，部署后调一次
 *
 * 幂等：重复跑安全（先判断字段是否已有）
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async () => {
  const report = {}

  // members: 补 playStyle/playStyleNote
  const membersRes = await db.collection('members').where({
    playStyle: _.exists(false)
  }).update({
    data: { playStyle: '', playStyleNote: '' }
  })
  report.members = membersRes.stats

  // tournaments: 补 courtTimeGrid (默认 null)
  const tournamentsRes = await db.collection('tournaments').where({
    courtTimeGrid: _.exists(false)
  }).update({
    data: { courtTimeGrid: null }
  })
  report.tournaments = tournamentsRes.stats

  // match_results: 补 resultStatus/submissions/confirmedAt/confirmedBy/disputeReason
  const matchResultsRes = await db.collection('match_results').where({
    resultStatus: _.exists(false)
  }).update({
    data: {
      resultStatus: 'pending',
      submissions: [],
      confirmedAt: null,
      confirmedBy: null,
      disputeReason: '',
      courtId: '',
      scheduledStart: null,
      scheduledSlotId: ''
    }
  })
  report.match_results = matchResultsRes.stats

  // tournament_brackets: matches[*] 内字段在生成时填，此处不需要补

  return { success: true, data: report }
}
