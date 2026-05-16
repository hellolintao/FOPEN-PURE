#!/usr/bin/env node

// Destructive local cleanup script for test cloud environments only.
// Usage:
//   FOPEN_CLOUD_ENV=<envId> FOPEN_CLEANUP_CONFIRM=<envId> FOPEN_RESET_BUSINESS_DATA=YES node scripts/cleanup-test-data.js
//
// All variables must be present, and the cloud env confirmation must match.
// This makes accidental production cleanup harder when shell history or copied
// commands are reused.

const tcb = require('@cloudbase/node-sdk')

const BUSINESS_COLLECTIONS = [
  'tournaments',
  'tournament_brackets',
  'tournament_registrations',
  'match_results',
  'tournament_points',
  'free_plays',
  'rank_snapshots',
  'weekly_stars'
]

const PAGE_SIZE = 1000

async function main() {
  const env = assertResetSafety(process.env)

  console.log(`>>> Target cloud env: ${env}`)
  console.log(`>>> Collections: ${BUSINESS_COLLECTIONS.join(' / ')}`)

  const app = tcb.init({ env })
  const db = app.database()

  const prerequisites = {
    members: await fetchCollectionRows(db, 'members'),
    courts: await fetchCollectionRows(db, 'courts')
  }
  assertFixturePrerequisites(prerequisites)

  console.log('>>> Fixture prerequisites satisfied.')
  console.log('>>> Destructive cleanup starts in 5 seconds. Press Ctrl-C to cancel.')
  await sleep(5000)

  await cleanupBusinessCollections(db)

  console.log('done.')
}

function assertResetSafety(env) {
  const cloudEnv = env.FOPEN_CLOUD_ENV
  const confirm = env.FOPEN_CLEANUP_CONFIRM

  if (!cloudEnv || cloudEnv !== confirm) {
    throw new Error(`FOPEN_CLEANUP_CONFIRM must be set and equal to FOPEN_CLOUD_ENV (FOPEN_CLOUD_ENV=${cloudEnv || '(unset)'}, FOPEN_CLEANUP_CONFIRM=${confirm || '(unset)'})`)
  }

  if (env.FOPEN_RESET_BUSINESS_DATA !== 'YES') {
    throw new Error('FOPEN_RESET_BUSINESS_DATA must be set to YES before destructive cleanup')
  }

  return cloudEnv
}

function assertFixturePrerequisites({ members = [], courts = [] } = {}) {
  const memberRows = Array.isArray(members) ? members : []
  const courtRows = Array.isArray(courts) ? courts : []
  const adminCount = memberRows.filter(isAdminMember).length
  const normalMemberCount = memberRows.filter(member => member && !isAdminMember(member)).length
  const enabledCourtCount = courtRows.filter(court => court && court.enabled === true).length

  if (adminCount < 1) {
    throw new Error('Fixture prerequisites failed: need at least 1 admin member before destructive cleanup')
  }

  if (normalMemberCount < 5) {
    throw new Error('Fixture prerequisites failed: need at least 5 normal members before destructive cleanup')
  }

  if (enabledCourtCount < 2) {
    throw new Error('Fixture prerequisites failed: need at least 2 enabled courts before destructive cleanup')
  }
}

function isAdminMember(member) {
  return member && (member.admin === true || member.isAdmin === true)
}

async function cleanupBusinessCollections(db, collections = BUSINESS_COLLECTIONS, log = console.log) {
  for (const name of collections) {
    const total = await countCollection(db, name)
    if (total === null) {
      log(`>>> ${name}: collection does not exist, skipped`)
      continue
    }
    log(`>>> ${name}: ${total} rows before cleanup`)
    if (total === 0) continue

    let removed = 0
    while (true) {
      const page = await db.collection(name).limit(PAGE_SIZE).get()
      const rows = page.data || []
      if (rows.length === 0) break

      for (const row of rows) {
        if (!row._id) continue
        await db.collection(name).doc(row._id).remove()
        removed += 1
      }
    }

    const remaining = await countCollection(db, name)
    log(`<<< ${name}: removed ${removed}, remaining ${remaining}`)
  }
}

async function countCollection(db, name) {
  try {
    const result = await db.collection(name).count()
    return result.total || 0
  } catch (err) {
    if (err && err.code === 'DATABASE_COLLECTION_NOT_EXIST') return null
    throw err
  }
}

async function fetchCollectionRows(db, name) {
  const result = await db.collection(name).limit(PAGE_SIZE).get()
  return result.data || []
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[abort] ${err.message}`)
    process.exit(1)
  })
}

module.exports = {
  BUSINESS_COLLECTIONS,
  assertResetSafety,
  assertFixturePrerequisites,
  cleanupBusinessCollections,
  countCollection
}
