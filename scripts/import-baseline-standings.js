#!/usr/bin/env node

const {
  SEASON_ID,
  flattenBaselineStandings,
  validateBaselineStandings,
} = require('./lib/baseline-standings-data');

async function importBaselineStandings(db, options = {}) {
  if (!db || typeof db.collection !== 'function') {
    throw new Error('db with collection(name) is required');
  }

  const now = options.now || new Date();
  const rows = options.rows || flattenBaselineStandings(undefined, SEASON_ID);
  const validation = validateBaselineStandings(rows);
  if (!validation.valid) {
    throw new Error(`Invalid baseline standings: ${validation.errors.join('; ')}`);
  }

  const baselineCollection = db.collection('baseline_standings');
  const memberCollection = db.collection('members');
  const playerNames = new Set();

  for (const row of rows) {
    playerNames.add(row.playerName);
  }

  const memberIdsByName = new Map();
  const missingPlayerNames = [];
  let existingMembersSkipped = 0;

  for (const playerName of playerNames) {
    const existingMembers = await findMembersByName(memberCollection, playerName);
    if (existingMembers.length > 1) {
      const ids = existingMembers.map((member) => member._id || '(missing _id)').join(', ');
      throw new Error(`Multiple members found for playerName "${playerName}": ${ids}`);
    }

    if (existingMembers.length === 1) {
      if (!existingMembers[0]._id) {
        throw new Error(`Member found for playerName "${playerName}" is missing _id`);
      }
      memberIdsByName.set(playerName, existingMembers[0]._id);
      existingMembersSkipped += 1;
      continue;
    }

    const memberId = buildUnclaimedMemberId(playerName);
    memberIdsByName.set(playerName, memberId);
    missingPlayerNames.push(playerName);
  }

  let unclaimedMembersCreated = 0;
  for (const playerName of missingPlayerNames) {
    const memberId = memberIdsByName.get(playerName);
    const existingMember = await getDocumentById(memberCollection, memberId);
    await upsertDocument(memberCollection, memberId, {
      _id: memberId,
      name: playerName,
      avatarUrl: '/images/icons/usercenter.png',
      status: 'active',
      claimStatus: 'unclaimed',
      admin: false,
      source: 'baseline_import',
      createdBy: 'baseline_import',
      createTime: existingMember && existingMember.createTime ? existingMember.createTime : now,
      updateTime: now,
    }, Boolean(existingMember));
    if (!existingMember) {
      unclaimedMembersCreated += 1;
    }
  }

  const rankByType = new Map();
  let baselineStandingsUpserted = 0;

  for (const row of rows) {
    const rank = (rankByType.get(row.type) || 0) + 1;
    rankByType.set(row.type, rank);

    const id = buildBaselineStandingId(row);
    const existingBaseline = await getDocumentById(baselineCollection, id);
    const createTime = existingBaseline && existingBaseline.createTime
      ? existingBaseline.createTime
      : now;
    const createdAt = existingBaseline && existingBaseline.createdAt
      ? existingBaseline.createdAt
      : now;

    await upsertDocument(baselineCollection, id, {
      _id: id,
      seasonId: row.seasonId,
      type: row.type,
      memberId: memberIdsByName.get(row.playerName),
      playerName: row.playerName,
      rank,
      totalPoints: row.totalPoints,
      wins: row.wins,
      losses: row.losses,
      source: 'baseline_import',
      baseline: true,
      createTime,
      updateTime: now,
      createdAt,
      updatedAt: now,
    }, Boolean(existingBaseline));
    baselineStandingsUpserted += 1;
  }

  return {
    baselineStandingsUpserted,
    unclaimedMembersCreated,
    existingMembersSkipped,
  };
}

function buildBaselineStandingId(row) {
  return `baseline_${row.seasonId}_${row.type}_${row.playerName}`;
}

function buildUnclaimedMemberId(playerName) {
  return `unclaimed_${playerName}`;
}

async function findMembersByName(collection, name) {
  const result = await collection.where({ name }).get();
  return result && Array.isArray(result.data) ? result.data : [];
}

async function getDocumentById(collection, id) {
  const doc = collection.doc(id);
  if (doc && typeof doc.get === 'function') {
    const result = await doc.get();
    if (result && Array.isArray(result.data)) {
      return result.data[0] || null;
    }
    if (result && result.data && typeof result.data === 'object') {
      return result.data;
    }
  }

  if (typeof collection.where === 'function') {
    const result = await collection.where({ _id: id }).limit(1).get();
    if (result && Array.isArray(result.data)) {
      return result.data[0] || null;
    }
  }

  return null;
}

async function upsertDocument(collection, id, data, exists) {
  const doc = collection.doc(id);
  if (!doc) {
    throw new Error('collection must support doc(id)');
  }
  const payload = omitDocumentId(data);

  if (exists) {
    if (typeof doc.update !== 'function') {
      throw new Error('document must support update(data)');
    }
    return doc.update(payload);
  }

  if (typeof doc.set !== 'function') {
    throw new Error('document must support set(data)');
  }
  return doc.set(payload);
}

function omitDocumentId(data) {
  if (!data || !Object.prototype.hasOwnProperty.call(data, '_id')) {
    return data;
  }

  const { _id, ...payload } = data;
  return payload;
}

function loadCloudbaseSdk() {
  return require('@cloudbase/node-sdk');
}

async function mainCli() {
  const env = process.env.FOPEN_CLOUD_ENV || process.env.WX_CLOUD_ENV;
  if (!env) {
    throw new Error('FOPEN_CLOUD_ENV or WX_CLOUD_ENV is required');
  }

  const tcb = loadCloudbaseSdk();
  const app = tcb.init({ env });
  const summary = await importBaselineStandings(app.database());
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  mainCli().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  SEASON_ID,
  importBaselineStandings,
  buildBaselineStandingId,
  buildUnclaimedMemberId,
};
