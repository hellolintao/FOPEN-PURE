'use strict';

/**
 * 排程约束（纯函数，无副作用）。
 * 数据结构：match = { matchId, type, player1:{id,partnerId?}, player2:{id,partnerId?}, ... }
 * assigned 元素 = match + { slotId, courtId }。
 *
 * 设计要点：
 * - 双打把 player1.partnerId / player2.partnerId 全部纳入冲突 / 休息约束
 *   （同一会员不能同时在两块场地打球）。
 * - TBD / BYE 占位 id 在 collectMatchPlayerIds 处过滤，不进入约束判断。
 */

const PLACEHOLDER_IDS = new Set(['', 'TBD', 'BYE', undefined, null]);

function collectMatchPlayerIds(match) {
  if (!match) return [];
  const raw = [
    match.player1 && match.player1.id,
    match.player1 && match.player1.partnerId,
    match.player2 && match.player2.id,
    match.player2 && match.player2.partnerId
  ];
  return raw.filter((id) => !PLACEHOLDER_IDS.has(id));
}

function isPlayerFree(playerId, slotId, assignedMatches) {
  if (PLACEHOLDER_IDS.has(playerId)) return true;
  return !assignedMatches.some((m) => {
    if (m.slotId !== slotId) return false;
    return collectMatchPlayerIds(m).includes(playerId);
  });
}

function isMatchFreeOfConflicts(match, slotId, assignedMatches) {
  const ids = collectMatchPlayerIds(match);
  return ids.every((id) => isPlayerFree(id, slotId, assignedMatches));
}

function hasRestBetween(playerId, slotId, assignedMatches, allSlots) {
  if (PLACEHOLDER_IDS.has(playerId)) return true;
  const slotIndex = allSlots.findIndex((s) => s.slotId === slotId);
  if (slotIndex < 0) return true;
  for (const m of assignedMatches) {
    if (!collectMatchPlayerIds(m).includes(playerId)) continue;
    const pmIndex = allSlots.findIndex((s) => s.slotId === m.slotId);
    if (pmIndex < 0) continue;
    if (Math.abs(slotIndex - pmIndex) === 1) return false;
  }
  return true;
}

function matchHasRestBetween(match, slotId, assignedMatches, allSlots) {
  const ids = collectMatchPlayerIds(match);
  return ids.every((id) => hasRestBetween(id, slotId, assignedMatches, allSlots));
}

module.exports = {
  collectMatchPlayerIds,
  isPlayerFree,
  isMatchFreeOfConflicts,
  hasRestBetween,
  matchHasRestBetween
};
