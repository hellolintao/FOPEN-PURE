#!/usr/bin/env node
const path = require('path')

const { aggregateRanks } = require(path.join(__dirname, '..', 'cloudfunctions', 'points-engine', 'lib', 'aggregate'))
const { buildSnapshotRows } = require(path.join(__dirname, '..', 'cloudfunctions', 'weekly-star', 'lib', 'snapshot-writer'))
const { toDateKey } = require(path.join(__dirname, '..', 'cloudfunctions', 'weekly-star', 'lib', 'week-window'))

async function runBackfill({ db, seasonId, now = new Date() }) {
  const day = toDateKey(now)
  const week = { weekId: `baseline_${day}`, weekStart: day, weekEnd: day, end: now }
  let total = 0
  for (const type of ['singles', 'doubles']) {
    const ranked = await aggregateRanks({ db, seasonId, type, pageSize: 100 })
    const rows = buildSnapshotRows({ ranked, week, seasonId, type, snapshotKind: 'baseline', computedAt: now })
    for (const row of rows) {
      try {
        await db.collection('rank_snapshots').doc(row._id).update({ data: row })
      } catch (e) {
        await db.collection('rank_snapshots').add({ data: row })
      }
      total++
    }
  }
  return { total }
}

function loadCloudSdk() {
  try {
    return require('wx-server-sdk')
  } catch (e) {
    return require(path.join(__dirname, '..', 'cloudfunctions', 'weekly-star', 'node_modules', 'wx-server-sdk'))
  }
}

async function mainCli() {
  const cloud = loadCloudSdk()
  cloud.init({ env: process.env.WX_CLOUD_ENV || cloud.DYNAMIC_CURRENT_ENV })
  const db = cloud.database()
  const seasonId = process.env.SEASON_ID || `season_${new Date().getFullYear()}`
  const { total } = await runBackfill({ db, seasonId, now: new Date() })
  console.log(`[backfill] wrote ${total} baseline rows for seasonId=${seasonId}`)
}

if (require.main === module) {
  mainCli().then(() => process.exit(0)).catch(err => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = { runBackfill }
