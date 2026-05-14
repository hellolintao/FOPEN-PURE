'use strict';

/**
 * 单败淘汰签表生成。
 *
 * 标准布签（standard seeding）：
 * - 把人数补齐到最近的 2^N（不够补 BYE）
 * - R1 第 1 场 = seed1 vs seedN；R1 第 i 场对位由递归 interleave 决定，
 *   保证 seed1 与 seed2 在不同半区（决赛才碰）
 * - R2 及以后：占位 TBD，等结果出来再填
 *
 * 入参 registrations：[{playerId, playerName, partnerId?, partnerName?, teamName?, seed?, type, _id}]
 * 第二参数 eliminationType 当前仅支持 'single'，'double' 后续迭代。
 */

const BYE_REG = Object.freeze({
  _id: 'bye',
  playerId: 'BYE',
  playerName: 'BYE',
  type: 'singles',
  seed: 9999,
  isBye: true
});

function generateKnockout(registrations, eliminationType = 'single') {
  if (!Array.isArray(registrations) || registrations.length < 2) return [];

  const detectedType = registrations.find((r) => r.type === 'doubles') ? 'doubles' : 'singles';
  const sorted = sortBySeed(registrations);
  const N = nextPowerOf2(sorted.length);
  while (sorted.length < N) sorted.push(BYE_REG);

  const order = standardBracketOrder(N); // 数组，元素是 seed 编号 1..N
  const ordered = order.map((seedIdx) => sorted[seedIdx - 1]);

  const matches = [];
  const r1Count = N / 2;

  for (let i = 0; i < r1Count; i++) {
    matches.push(buildMatch({
      type: detectedType,
      round: 1,
      position: i + 1,
      reg1: ordered[i * 2],
      reg2: ordered[i * 2 + 1]
    }));
  }

  let prevCount = r1Count;
  let round = 2;
  while (prevCount > 1) {
    const count = prevCount / 2;
    for (let i = 0; i < count; i++) {
      matches.push(buildPlaceholderMatch({
        type: detectedType,
        round,
        position: i + 1
      }));
    }
    prevCount = count;
    round += 1;
  }
  return matches;
}

function sortBySeed(list) {
  return [...list].map((r, i) => ({
    ...r,
    seed: (typeof r.seed === 'number' && r.seed > 0) ? r.seed : i + 1
  })).sort((a, b) => a.seed - b.seed);
}

function nextPowerOf2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function standardBracketOrder(N) {
  if (N === 1) return [1];
  if (N === 2) return [1, 2];
  const prev = standardBracketOrder(N / 2);
  const result = [];
  for (const x of prev) {
    result.push(x);
    result.push(N + 1 - x);
  }
  return result;
}

function buildMatch({ type, round, position, reg1, reg2 }) {
  return {
    matchId: `ko_r${round}_p${position}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    round,
    position,
    type,
    player1: regToPlayer(reg1, type),
    player2: regToPlayer(reg2, type),
    status: 'pending'
  };
}

function buildPlaceholderMatch({ type, round, position }) {
  const placeholder = (type === 'doubles')
    ? { id: 'TBD', name: '待定', partnerId: 'TBD', partnerName: '待定', teamName: '待定' }
    : { id: 'TBD', name: '待定' };
  return {
    matchId: `ko_r${round}_p${position}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    round,
    position,
    type,
    player1: { ...placeholder },
    player2: { ...placeholder },
    status: 'pending'
  };
}

function regToPlayer(reg, type) {
  if (reg.isBye || reg.playerId === 'BYE') {
    return (type === 'doubles')
      ? { id: 'BYE', name: 'BYE', partnerId: 'BYE', partnerName: 'BYE', teamName: 'BYE' }
      : { id: 'BYE', name: 'BYE' };
  }
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

module.exports = { generateKnockout };
