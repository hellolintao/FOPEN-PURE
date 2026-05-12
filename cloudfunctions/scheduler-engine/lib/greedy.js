'use strict';

const { isMatchFreeOfConflicts, matchHasRestBetween } = require('./constraints');

/**
 * 贪心排程：按 round 升序、原顺序遍历 match，
 * 依次试每个 (slot, court) 格子，找到第一个不违反约束的位置放下。
 *
 * 返回 { scheduled: [...], unscheduled: [...] }，不修改入参（immutable）。
 * 每个 scheduled[i] 是原 match 的副本，附加 slotId / scheduledSlotId / courtId / scheduledStart / status。
 */
function schedule(matches, grid) {
  if (!matches || matches.length === 0) return { scheduled: [], unscheduled: [] };
  if (!grid || !Array.isArray(grid.slots) || grid.slots.length === 0) {
    return { scheduled: [], unscheduled: [...matches] };
  }

  const sortedMatches = [...matches].sort((a, b) => (a.round || 0) - (b.round || 0));
  const assigned = [];
  const unscheduled = [];

  for (const match of sortedMatches) {
    const placed = tryPlace(match, grid, assigned);
    if (placed) {
      assigned.push(placed);
    } else {
      unscheduled.push(match);
    }
  }

  return { scheduled: assigned, unscheduled };
}

function tryPlace(match, grid, assigned) {
  for (const slot of grid.slots) {
    const courtIds = Array.isArray(slot.availableCourtIds) ? slot.availableCourtIds : [];
    for (const courtId of courtIds) {
      const cellTaken = assigned.some((a) => a.slotId === slot.slotId && a.courtId === courtId);
      if (cellTaken) continue;

      if (!isMatchFreeOfConflicts(match, slot.slotId, assigned)) continue;
      if (!matchHasRestBetween(match, slot.slotId, assigned, grid.slots)) continue;

      return {
        ...match,
        slotId: slot.slotId,
        scheduledSlotId: slot.slotId,
        courtId,
        scheduledStart: slot.start,
        status: match.status || 'pending'
      };
    }
  }
  return null;
}

module.exports = { schedule };
