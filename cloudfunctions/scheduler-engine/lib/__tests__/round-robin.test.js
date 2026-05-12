const { generateRoundRobin } = require('../pairing/round-robin');

function singlesRegs(ids) {
  return ids.map((id, i) => ({
    _id: `reg_${id}`,
    playerId: id,
    playerName: id.toUpperCase(),
    type: 'singles',
    seed: i + 1
  }));
}

function doublesRegs(teams) {
  // teams: [[a, b], [c, d], ...] each pair → one registration (team)
  return teams.map(([p, partner], i) => ({
    _id: `reg_${p}_${partner}`,
    playerId: p,
    playerName: p.toUpperCase(),
    partnerId: partner,
    partnerName: partner.toUpperCase(),
    teamName: `T${i + 1}`,
    type: 'doubles',
    seed: i + 1
  }));
}

describe('generateRoundRobin (singles)', () => {
  test('4 人 1 轮 → 2 场，每人在该轮各 1 场', () => {
    const r = generateRoundRobin(singlesRegs(['a', 'b', 'c', 'd']), 1, 'singles');
    expect(r).toHaveLength(2);
    const ids = r.flatMap((m) => [m.player1.id, m.player2.id]);
    expect(new Set(ids).size).toBe(4);
  });

  test('4 人 2 轮 → 4 场（每轮 2 场）', () => {
    const r = generateRoundRobin(singlesRegs(['a', 'b', 'c', 'd']), 2, 'singles');
    expect(r).toHaveLength(4);
    expect(r.filter((m) => m.round === 1)).toHaveLength(2);
    expect(r.filter((m) => m.round === 2)).toHaveLength(2);
  });

  test('5 人 1 轮 → 2 场（最后一人本轮轮空）', () => {
    const r = generateRoundRobin(singlesRegs(['a', 'b', 'c', 'd', 'e']), 1, 'singles');
    expect(r).toHaveLength(2);
    const players = r.flatMap((m) => [m.player1.id, m.player2.id]);
    expect(players).toHaveLength(4);
  });

  test('matchId 唯一', () => {
    const r = generateRoundRobin(singlesRegs(['a', 'b', 'c', 'd']), 2, 'singles');
    const ids = r.map((m) => m.matchId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('每场带 type / player1.id / player2.id / round / position', () => {
    const r = generateRoundRobin(singlesRegs(['a', 'b', 'c', 'd']), 1, 'singles');
    r.forEach((m, i) => {
      expect(m.type).toBe('singles');
      expect(m.round).toBe(1);
      expect(m.position).toBe(i + 1);
      expect(m.player1.id).toBeDefined();
      expect(m.player1.name).toBeDefined();
      expect(m.player1.registrationId).toBeDefined();
      expect(m.player2.id).toBeDefined();
      expect(m.status).toBe('pending');
    });
  });

  test('0 轮 → 空', () => {
    expect(generateRoundRobin(singlesRegs(['a', 'b']), 0, 'singles')).toEqual([]);
  });

  test('1 人 → 没法配对 → 空', () => {
    expect(generateRoundRobin(singlesRegs(['a']), 1, 'singles')).toEqual([]);
  });
});

describe('generateRoundRobin (doubles)', () => {
  test('4 队 1 轮 → 2 场（每队 1 场）', () => {
    const regs = doublesRegs([['a', 'ap'], ['b', 'bp'], ['c', 'cp'], ['d', 'dp']]);
    const r = generateRoundRobin(regs, 1, 'doubles');
    expect(r).toHaveLength(2);
    r.forEach((m) => {
      expect(m.type).toBe('doubles');
      expect(m.player1.partnerId).toBeDefined();
      expect(m.player1.partnerName).toBeDefined();
      expect(m.player2.partnerId).toBeDefined();
    });
  });

  test('双打：player1/player2 携带 teamName', () => {
    const regs = doublesRegs([['a', 'ap'], ['b', 'bp']]);
    const r = generateRoundRobin(regs, 1, 'doubles');
    expect(r).toHaveLength(1);
    expect(r[0].player1.teamName || r[0].player1.name).toBeTruthy();
    expect(r[0].player2.teamName || r[0].player2.name).toBeTruthy();
  });
});
