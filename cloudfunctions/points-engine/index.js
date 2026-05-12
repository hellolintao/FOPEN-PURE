const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const { calculatePoints, isPointValid } = require('./lib/calculate');

exports.main = async (event) => {
  const { action } = event;
  if (action === 'rankList') return await rankList(event);
  if (action === 'playerStats') return await playerStats(event);
  if (action === 'recalculateMatch') return await recalculateMatch(event);
  return { success: false, error: { code: 'UNKNOWN_ACTION', message: action } };
};

async function rankList({ type = 'singles', currentSeasonId }) {
  const matches = (await db.collection('match_results')
    .where({ resultStatus: 'confirmed' })
    .get()).data;
  const tournaments = await fetchTournaments(matches.map(m => m.tournamentId));
  const map = {};
  for (const m of matches) {
    const t = tournaments[m.tournamentId];
    if (!t || t.type !== type) continue;
    const meta = { seasonId: t.seasonId, format: t.format, createTime: m.createTime };
    if (!isPointValid(meta, currentSeasonId)) continue;
    const award = m.pointsAwarded || {};
    addPoints(map, m.winnerId, award.winner?.total || 0, true);
    addPoints(map, m.loserId, award.loser?.total || 0, false);
  }
  const memberIds = Object.keys(map);
  if (memberIds.length === 0) return { success: true, data: { rankList: [] } };
  const members = (await db.collection('members').where({ _id: _.in(memberIds) }).get()).data;
  const list = members.map(mb => ({
    _id: mb._id,
    name: mb.name,
    avatarUrl: mb.avatarUrl,
    ...map[mb._id]
  })).sort((a, b) => b.totalPoints - a.totalPoints);
  return { success: true, data: { rankList: list } };
}

function addPoints(map, id, pts, isWin) {
  if (!id) return;
  if (!map[id]) map[id] = { totalPoints: 0, winCount: 0, lossCount: 0 };
  map[id].totalPoints += pts;
  if (isWin) map[id].winCount++; else map[id].lossCount++;
}

async function fetchTournaments(ids) {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return {};
  const list = (await db.collection('tournaments').where({ _id: _.in(unique) }).get()).data;
  const map = {};
  list.forEach(t => { map[t._id] = t; });
  return map;
}

async function playerStats({ playerId, currentSeasonId }) {
  const winMatches = (await db.collection('match_results').where({ winnerId: playerId, resultStatus: 'confirmed' }).get()).data;
  const loseMatches = (await db.collection('match_results').where({ loserId: playerId, resultStatus: 'confirmed' }).get()).data;
  const all = [...winMatches, ...loseMatches];
  const tournaments = await fetchTournaments(all.map(m => m.tournamentId));

  const stats = { singles: { winCount: 0, lossCount: 0, totalPoints: 0 }, doubles: { winCount: 0, lossCount: 0, totalPoints: 0 } };
  const recent = all.sort((a, b) => new Date(b.createTime) - new Date(a.createTime)).slice(0, 10);

  for (const m of all) {
    const t = tournaments[m.tournamentId];
    if (!t) continue;
    const meta = { seasonId: t.seasonId, format: t.format, createTime: m.createTime };
    if (!isPointValid(meta, currentSeasonId)) continue;
    const bucket = stats[t.type] || stats.singles;
    const isWin = m.winnerId === playerId;
    if (isWin) bucket.winCount++; else bucket.lossCount++;
    const pts = isWin ? (m.pointsAwarded?.winner?.total || 0) : (m.pointsAwarded?.loser?.total || 0);
    bucket.totalPoints += pts;
  }

  return { success: true, data: { stats, recent } };
}

async function recalculateMatch({ matchId }) {
  const match = (await db.collection('match_results').doc(matchId).get()).data;
  const tournament = (await db.collection('tournaments').doc(match.tournamentId).get()).data;
  const pointsAwarded = calculatePoints(match, tournament);
  await db.collection('match_results').doc(matchId).update({ data: { pointsAwarded } });
  return { success: true, data: { pointsAwarded } };
}
