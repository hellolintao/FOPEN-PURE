'use strict';

/**
 * 常规赛配对生成：每轮把所有报名随机分组，两两成对。
 * 单打：playerId + name → player1 / player2
 * 双打：playerId + partnerId + teamName → player1 / player2（每个 "player" 实际上代表一支队伍）
 * 奇数人/奇数队 → 最后一个本轮轮空（不报错）。
 */

function generateRoundRobin(registrations, totalRounds, type) {
  if (!Array.isArray(registrations) || registrations.length < 2) return [];
  if (!totalRounds || totalRounds < 1) return [];

  const matches = [];
  for (let round = 1; round <= totalRounds; round++) {
    const shuffled = shuffle(registrations);
    let position = 1;
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      const reg1 = shuffled[i];
      const reg2 = shuffled[i + 1];
      matches.push(buildMatch({
        type,
        round,
        position,
        reg1,
        reg2
      }));
      position += 1;
    }
  }
  return matches;
}

function buildMatch({ type, round, position, reg1, reg2 }) {
  return {
    matchId: `rr_r${round}_p${position}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    round,
    position,
    type,
    player1: regToPlayer(reg1, type),
    player2: regToPlayer(reg2, type),
    status: 'pending'
  };
}

function regToPlayer(reg, type) {
  if (type === 'doubles') {
    return {
      id: reg.playerId,
      name: reg.playerName,
      partnerId: reg.partnerId || '',
      partnerName: reg.partnerName || '',
      teamName: reg.teamName || '',
      registrationId: reg._id
    };
  }
  return {
    id: reg.playerId,
    name: reg.playerName,
    registrationId: reg._id
  };
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = { generateRoundRobin };
