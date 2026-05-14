#!/usr/bin/env node

// Destructive local cleanup script for test cloud environments only.
// Usage:
//   FOPEN_CLOUD_ENV=<envId> FOPEN_CLEANUP_CONFIRM=<envId> node scripts/cleanup-test-data.js
//
// Both variables must be present and equal. This makes accidental production
// cleanup harder when shell history or copied commands are reused.

const tcb = require('@cloudbase/node-sdk')

const TARGETS = [
  'tournaments',
  'tournament_brackets',
  'tournament_registrations',
  'match_results',
  'tournament_points',
  'free_plays'
]

const PAGE_SIZE = 1000

async function main() {
  const env = process.env.FOPEN_CLOUD_ENV
  const confirm = process.env.FOPEN_CLEANUP_CONFIRM

  if (!env || env !== confirm) {
    console.error('[abort] FOPEN_CLEANUP_CONFIRM must be set and equal to FOPEN_CLOUD_ENV')
    console.error(`  FOPEN_CLOUD_ENV = ${env || '(unset)'}`)
    console.error(`  FOPEN_CLEANUP_CONFIRM = ${confirm || '(unset)'}`)
    process.exit(1)
  }

  console.log(`>>> Target cloud env: ${env}`)
  console.log(`>>> Collections: ${TARGETS.join(' / ')}`)
  console.log('>>> Destructive cleanup starts in 5 seconds. Press Ctrl-C to cancel.')
  await sleep(5000)

  const app = tcb.init({ env })
  const db = app.database()

  for (const name of TARGETS) {
    const total = await countCollection(db, name)
    if (total === null) {
      console.log(`>>> ${name}: collection does not exist, skipped`)
      continue
    }
    console.log(`>>> ${name}: ${total} rows before cleanup`)
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
    console.log(`<<< ${name}: removed ${removed}, remaining ${remaining}`)
  }

  console.log('done.')
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
