const {
  BUSINESS_COLLECTIONS,
  assertResetSafety,
  assertFixturePrerequisites,
  cleanupBusinessCollections,
} = require('../cleanup-test-data')

function makeFakeDb(initialRows, missingCollections = []) {
  const rows = Object.fromEntries(
    Object.entries(initialRows).map(([name, collectionRows]) => [
      name,
      collectionRows.map(row => ({ ...row })),
    ])
  )
  const touched = []

  return {
    rows,
    touched,
    collection(name) {
      touched.push(name)
      if (missingCollections.includes(name)) {
        return {
          count: async () => {
            const err = new Error('missing collection')
            err.code = 'DATABASE_COLLECTION_NOT_EXIST'
            throw err
          },
          limit: () => ({ get: async () => ({ data: [] }) }),
          doc: () => ({ remove: async () => {} }),
        }
      }

      return {
        count: async () => ({ total: (rows[name] || []).length }),
        limit: () => ({
          get: async () => ({ data: (rows[name] || []).slice() }),
        }),
        doc: id => ({
          remove: async () => {
            rows[name] = (rows[name] || []).filter(row => row._id !== id)
          },
        }),
      }
    },
  }
}

describe('cleanup-test-data safety contract', () => {
  test('business collections include rank snapshots and weekly stars', () => {
    expect(BUSINESS_COLLECTIONS).toEqual([
      'tournaments',
      'tournament_brackets',
      'tournament_registrations',
      'match_results',
      'tournament_points',
      'free_plays',
      'rank_snapshots',
      'weekly_stars',
    ])
  })

  test('requires FOPEN_RESET_BUSINESS_DATA=YES in addition to matching env confirmation', () => {
    expect(() => assertResetSafety({
      FOPEN_CLOUD_ENV: 'cloud_test',
      FOPEN_CLEANUP_CONFIRM: 'cloud_test',
    })).toThrow(/FOPEN_RESET_BUSINESS_DATA/)

    expect(() => assertResetSafety({
      FOPEN_CLOUD_ENV: 'cloud_test',
      FOPEN_CLEANUP_CONFIRM: 'cloud_test',
      FOPEN_RESET_BUSINESS_DATA: 'YES',
    })).not.toThrow()
  })

  test('rejects mismatched cloud env confirmation', () => {
    expect(() => assertResetSafety({
      FOPEN_CLOUD_ENV: 'cloud_a',
      FOPEN_CLEANUP_CONFIRM: 'cloud_b',
      FOPEN_RESET_BUSINESS_DATA: 'YES',
    })).toThrow(/FOPEN_CLEANUP_CONFIRM/)
  })

  test('requires at least one admin before destructive cleanup', () => {
    expect(() => assertFixturePrerequisites()).toThrow(/admin/)

    expect(() => assertFixturePrerequisites({
      members: [
        { _id: 'm1' },
        { _id: 'm2' },
        { _id: 'm3' },
        { _id: 'm4' },
        { _id: 'm5' },
      ],
      courts: [{ _id: 'c1', enabled: true }, { _id: 'c2', enabled: true }],
    })).toThrow(/admin/)
  })

  test('accepts either admin or isAdmin flag for admin prerequisite', () => {
    expect(() => assertFixturePrerequisites({
      members: [
        { _id: 'admin', isAdmin: true },
        { _id: 'm1' },
        { _id: 'm2' },
        { _id: 'm3' },
        { _id: 'm4' },
        { _id: 'm5' },
      ],
      courts: [{ _id: 'c1', enabled: true }, { _id: 'c2', enabled: true }],
    })).not.toThrow()
  })

  test('requires five normal members before destructive cleanup', () => {
    expect(() => assertFixturePrerequisites({
      members: [
        { _id: 'admin', admin: true },
        { _id: 'm1' },
        { _id: 'm2' },
        { _id: 'm3' },
        { _id: 'm4' },
      ],
      courts: [{ _id: 'c1', enabled: true }, { _id: 'c2', enabled: true }],
    })).toThrow(/5 normal members/)
  })

  test('requires at least two explicitly enabled courts before destructive cleanup', () => {
    expect(() => assertFixturePrerequisites({
      members: [
        { _id: 'admin', admin: true },
        { _id: 'm1' },
        { _id: 'm2' },
        { _id: 'm3' },
        { _id: 'm4' },
        { _id: 'm5' },
      ],
      courts: [{ _id: 'c1', enabled: true }, { _id: 'c2' }],
    })).toThrow(/2 enabled courts/)
  })

  test('allows cleanup when fixture prerequisites are satisfied', () => {
    expect(() => assertFixturePrerequisites({
      members: [
        { _id: 'admin', admin: true },
        { _id: 'm1' },
        { _id: 'm2' },
        { _id: 'm3' },
        { _id: 'm4' },
        { _id: 'm5' },
      ],
      courts: [{ _id: 'c1', enabled: true }, { _id: 'c2', enabled: true }],
    })).not.toThrow()
  })

  test('cleanup helper supports narrowed collections, injected logging, and missing collection skips', async () => {
    const db = makeFakeDb({
      tournaments: [{ _id: 't1' }],
      match_results: [{ _id: 'm1' }],
      free_plays: [{ _id: 'f1' }],
    }, ['missing_collection'])
    const logs = []

    await cleanupBusinessCollections(
      db,
      ['match_results', 'missing_collection'],
      message => logs.push(message)
    )

    expect(db.rows).toEqual({
      tournaments: [{ _id: 't1' }],
      match_results: [],
      free_plays: [{ _id: 'f1' }],
    })
    expect(db.touched).not.toContain('tournaments')
    expect(db.touched).not.toContain('free_plays')
    expect(logs).toEqual([
      '>>> match_results: 1 rows before cleanup',
      '<<< match_results: removed 1, remaining 0',
      '>>> missing_collection: collection does not exist, skipped',
    ])
  })
})
