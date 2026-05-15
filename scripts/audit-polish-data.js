#!/usr/bin/env node

const tcb = require('@cloudbase/node-sdk')

const PAGE_SIZE = 1000

async function main() {
  const env = process.env.FOPEN_CLOUD_ENV
  const seasonId = process.env.FOPEN_SEASON_ID || `s${new Date().getFullYear()}`

  if (!env) {
    console.error('[abort] FOPEN_CLOUD_ENV is required')
    console.error('usage: FOPEN_CLOUD_ENV=<envId> FOPEN_SEASON_ID=s2026 node scripts/audit-polish-data.js')
    process.exit(1)
  }

  const app = tcb.init({ env })
  const db = app.database()

  const members = await safeFetchAll(db, 'members', {})
  const matchResults = await safeFetchAll(db, 'match_results', { seasonId })
  const tournamentPoints = await safeFetchAll(db, 'tournament_points', { seasonId })

  const activeMembers = members.filter(member => member.status !== 'inactive')
  const displayReadyMembers = activeMembers.filter(member => member._id && member.name)
  const confirmedMatches = matchResults.filter(row => row.resultStatus === 'confirmed')
  const matchesWithEntries = confirmedMatches.filter(row => {
    const entries = row.pointsAwarded && row.pointsAwarded.entries
    return Array.isArray(entries) && entries.length > 0
  })

  const rankable = aggregateRankableMembers(matchesWithEntries, tournamentPoints)
  const membersById = new Map(members.map(member => [member._id, member]))
  const missingMemberRows = Array.from(rankable.keys()).filter(id => !membersById.has(id))
  const noNameRows = Array.from(rankable.keys()).filter(id => {
    const member = membersById.get(id)
    return member && !member.name
  })

  const report = {
    env,
    seasonId,
    members: members.length,
    activeMembers: activeMembers.length,
    displayReadyMembers: displayReadyMembers.length,
    matchResults: matchResults.length,
    confirmedMatches: confirmedMatches.length,
    matchesWithPointEntries: matchesWithEntries.length,
    tournamentPoints: tournamentPoints.length,
    rankableMembers: rankable.size,
    missingMemberRows,
    noNameRows,
    topRankPreview: Array.from(rankable.entries())
      .map(([memberId, points]) => ({
        memberId,
        points,
        name: (membersById.get(memberId) || {}).name || ''
      }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 10)
  }

  console.log(JSON.stringify(report, null, 2))

  const failures = []
  if (displayReadyMembers.length < 2) failures.push('members display data is insufficient: need at least 2 members with _id/name')
  if (matchesWithEntries.length < 1 && tournamentPoints.length < 1) failures.push('rank source is empty: need confirmed match_results.pointsAwarded.entries or tournament_points')
  if (rankable.size < 1) failures.push('rankable member count is 0')
  if (missingMemberRows.length > 0) failures.push(`rank references missing members: ${missingMemberRows.join(', ')}`)
  if (noNameRows.length > 0) failures.push(`rank references members without name: ${noNameRows.join(', ')}`)

  if (failures.length > 0) {
    console.error('\n[FAIL]')
    failures.forEach(failure => console.error(`- ${failure}`))
    process.exit(2)
  }

  console.log('\n[PASS] polish data is ready for rank, player-detail, and weekly-star.')
}

async function safeFetchAll(db, collectionName, filter) {
  try {
    const out = []
    for (let skip = 0; skip < 100000; skip += PAGE_SIZE) {
      const page = await db.collection(collectionName).where(filter).skip(skip).limit(PAGE_SIZE).get()
      const rows = page.data || []
      out.push(...rows)
      if (rows.length < PAGE_SIZE) break
    }
    return out
  } catch (err) {
    const msg = `${err.code || ''} ${err.message || ''} ${err.errMsg || ''}`
    if (
      err.errCode === -502005 ||
      /DATABASE_COLLECTION_NOT_EXIST|collection not exists|collection not exist|Db or Table not exist/i.test(msg)
    ) return []
    throw err
  }
}

function aggregateRankableMembers(matches, tournamentPoints) {
  const map = new Map()
  for (const row of matches) {
    const entries = (row.pointsAwarded && row.pointsAwarded.entries) || []
    for (const entry of entries) add(map, entry.memberId, entry.points)
  }
  for (const row of tournamentPoints) {
    add(map, row.memberId, row.points)
  }
  return map
}

function add(map, memberId, points) {
  if (!memberId) return
  map.set(memberId, (map.get(memberId) || 0) + (Number(points) || 0))
}

if (require.main === module) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = {
  PAGE_SIZE,
  aggregateRankableMembers,
  safeFetchAll
}
