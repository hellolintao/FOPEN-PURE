'use strict';

// @deprecated since Phase 7
// 算法已迁移到 cloudfunctions/tournament-brackets/lib/{generator,scheduler,pairing}
// 当前文件保留是为了让 Phase 1-4 单测继续可跑（44 例）。Phase 8 完成后再下线。
console.warn('[scheduler-engine] @deprecated — 请使用 tournament-brackets/lib');

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const { schedule } = require('./lib/greedy');
const { generateRoundRobin } = require('./lib/pairing/round-robin');
const { generateKnockout } = require('./lib/pairing/knockout-bracket');

/**
 * Scheduler entry.
 *
 * action = 'schedule'  → 拉 tournament + registrations，生成对阵 + 排程 + 幂等落库到 tournament_brackets
 * action = 'preview'   → 同上但不写库，仅返回 { rounds, scheduled, unscheduled }
 *
 * 入参 event: { action, tournamentId, totalRounds? }
 * 返回: { success: bool, data?: {...}, error?: { code, message } }
 */
exports.main = async (event = {}) => {
  const { action, tournamentId, totalRounds } = event;
  try {
    if (!tournamentId) {
      return errResp('MISSING_TOURNAMENT_ID', 'tournamentId 不能为空');
    }
    if (action === 'schedule') {
      return await runSchedule({ tournamentId, totalRounds, writeBack: true });
    }
    if (action === 'preview') {
      return await runSchedule({ tournamentId, totalRounds, writeBack: false });
    }
    return errResp('UNKNOWN_ACTION', `未知 action: ${action}`);
  } catch (err) {
    console.error('[scheduler-engine] 异常', err);
    return errResp('INTERNAL_ERROR', err && err.message ? err.message : '内部错误');
  }
};

async function runSchedule({ tournamentId, totalRounds, writeBack }) {
  const tournament = await loadTournament(tournamentId);
  if (!tournament) {
    return errResp('TOURNAMENT_NOT_FOUND', `赛事不存在: ${tournamentId}`);
  }
  if (!tournament.courtTimeGrid || !Array.isArray(tournament.courtTimeGrid.slots) || tournament.courtTimeGrid.slots.length === 0) {
    return errResp('GRID_EMPTY', '该赛事尚未配置场地/时段（courtTimeGrid 为空）');
  }

  const registrations = await loadRegistrations(tournamentId);
  if (registrations.length < 2) {
    return errResp('TOO_FEW_REGISTRATIONS', `报名人数不足（${registrations.length}）`);
  }

  const type = tournament.type === 'doubles' ? 'doubles' : 'singles';
  const format = tournament.format || 'regular';
  const rounds = decideTotalRounds(totalRounds, tournament);

  const generated = format === 'knockout'
    ? generateKnockout(registrations, (tournament.config && tournament.config.eliminationType) || 'single')
    : generateRoundRobin(registrations, rounds, type);

  if (!generated || generated.length === 0) {
    return errResp('NO_MATCHES_GENERATED', '配对生成结果为空');
  }

  const result = schedule(generated, tournament.courtTimeGrid);

  if (writeBack) {
    await writeBackBrackets(tournamentId, type, [...result.scheduled, ...result.unscheduled]);
  }

  return {
    success: true,
    data: {
      tournamentId,
      type,
      format,
      totalGenerated: generated.length,
      scheduledCount: result.scheduled.length,
      unscheduledCount: result.unscheduled.length,
      scheduled: result.scheduled,
      unscheduled: result.unscheduled
    }
  };
}

async function loadTournament(tournamentId) {
  try {
    const res = await db.collection('tournaments').doc(tournamentId).get();
    return res.data || null;
  } catch (err) {
    if (err && err.errCode === -1) return null; // doc not found 兼容
    throw err;
  }
}

async function loadRegistrations(tournamentId) {
  const res = await db.collection('tournament_registrations')
    .where({ tournamentId })
    .get();
  const data = (res && res.data) || [];
  return data.filter((r) => r.status !== 'withdrew' && r.status !== 'cancelled');
}

function decideTotalRounds(explicit, tournament) {
  if (typeof explicit === 'number' && explicit > 0) return explicit;
  if (tournament.config && typeof tournament.config.totalRounds === 'number' && tournament.config.totalRounds > 0) {
    return tournament.config.totalRounds;
  }
  return 4;
}

async function writeBackBrackets(tournamentId, type, allMatches) {
  const byRound = groupByRound(allMatches);
  for (const round of Object.keys(byRound).sort((a, b) => Number(a) - Number(b))) {
    const matches = byRound[round].map((m, idx) => normalizeMatchForBracket(m, idx + 1));
    await upsertBracket({ tournamentId, round: Number(round), type, matches });
  }
}

function groupByRound(matches) {
  const map = {};
  matches.forEach((m) => {
    const r = m.round || 1;
    if (!map[r]) map[r] = [];
    map[r].push(m);
  });
  return map;
}

function normalizeMatchForBracket(match, fallbackPosition) {
  const out = {
    matchId: match.matchId,
    position: match.position || fallbackPosition,
    player1: { ...match.player1 },
    player2: { ...match.player2 },
    status: match.status || 'pending'
  };
  if (match.courtId) out.courtId = match.courtId;
  if (match.scheduledStart) out.scheduledStart = match.scheduledStart;
  if (match.scheduledSlotId) out.scheduledSlotId = match.scheduledSlotId;
  return out;
}

async function upsertBracket({ tournamentId, round, type, matches }) {
  const existing = await callBrackets('getByRound', { tournamentId, round });
  const existingList = (existing && existing.data) || [];

  if (existingList.length > 0) {
    const id = existingList[0]._id;
    const mergedMatches = mergeMatches(existingList[0].matches || [], matches);
    const res = await callBrackets('update', {
      id,
      data: { tournamentId, round, type, matches: mergedMatches }
    });
    assertNoError(res, `update bracket round=${round}`);
    return id;
  }

  const res = await callBrackets('add', {
    data: { tournamentId, round, type, matches }
  });
  assertNoError(res, `add bracket round=${round}`);
  return res._id || (res.result && res.result._id);
}

/**
 * 合并新旧 matches：
 * - 按 position 索引旧 match
 * - 新 match 覆盖旧 match 的 player/courtId/scheduledStart（scheduler 是权威）
 * - 但保留旧 match 的 winner / score / submissions 等比赛进行中字段
 */
function mergeMatches(oldMatches, newMatches) {
  const oldByPos = {};
  oldMatches.forEach((m) => { oldByPos[m.position] = m; });
  return newMatches.map((nm) => {
    const old = oldByPos[nm.position];
    if (!old) return nm;
    const merged = { ...old, ...nm };
    if (old.winner !== undefined) merged.winner = old.winner;
    if (old.score !== undefined) merged.score = old.score;
    return merged;
  });
}

async function callBrackets(action, payload) {
  const res = await cloud.callFunction({
    name: 'tournament-brackets',
    data: { action, ...payload }
  });
  if (!res || !res.result) {
    throw new Error(`callFunction tournament-brackets:${action} 无返回`);
  }
  return res.result;
}

function assertNoError(res, ctx) {
  if (res && res.errMsg && typeof res.errMsg === 'string' && /failed|error|invalid/i.test(res.errMsg)) {
    const errors = res.errors ? `: ${JSON.stringify(res.errors)}` : '';
    throw new Error(`${ctx} 失败 → ${res.errMsg}${errors}`);
  }
}

function errResp(code, message) {
  return { success: false, error: { code, message } };
}
