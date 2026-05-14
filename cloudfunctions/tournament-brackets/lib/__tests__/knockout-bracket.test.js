const { generateKnockout } = require('../pairing/knockout-bracket');

function regs(ids) {
  return ids.map((id, i) => ({
    _id: `reg_${id}`,
    playerId: id,
    playerName: id.toUpperCase(),
    type: 'singles',
    seed: i + 1
  }));
}

describe('generateKnockout (single)', () => {
  test('8 人 → R1 4 场 / R2 2 场（TBD） / R3 1 场（TBD）', () => {
    const r = generateKnockout(regs(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), 'single');
    expect(r.filter((m) => m.round === 1)).toHaveLength(4);
    expect(r.filter((m) => m.round === 2)).toHaveLength(2);
    expect(r.filter((m) => m.round === 3)).toHaveLength(1);
  });

  test('4 人 → R1 2 场 / R2 1 场（决赛）', () => {
    const r = generateKnockout(regs(['a', 'b', 'c', 'd']), 'single');
    expect(r.filter((m) => m.round === 1)).toHaveLength(2);
    expect(r.filter((m) => m.round === 2)).toHaveLength(1);
  });

  test('标准布签：8 人 R1 第 1 场为 seed1 vs seed8', () => {
    const r = generateKnockout(regs(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), 'single');
    const r1 = r.filter((m) => m.round === 1).sort((a, b) => a.position - b.position);
    const ids = [r1[0].player1.id, r1[0].player2.id];
    expect(ids).toContain('a'); // seed1
    expect(ids).toContain('h'); // seed8
  });

  test('标准布签：seed1 与 seed2 在 R1 不同对（决赛才碰）', () => {
    const r = generateKnockout(regs(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), 'single');
    const r1 = r.filter((m) => m.round === 1);
    const matchOfSeed1 = r1.find((m) => m.player1.id === 'a' || m.player2.id === 'a');
    const matchOfSeed2 = r1.find((m) => m.player1.id === 'b' || m.player2.id === 'b');
    expect(matchOfSeed1.matchId).not.toBe(matchOfSeed2.matchId);
  });

  test('非 2^N 人数（6 人）→ 自动补 BYE 到 8', () => {
    const r = generateKnockout(regs(['a', 'b', 'c', 'd', 'e', 'f']), 'single');
    const r1 = r.filter((m) => m.round === 1);
    expect(r1).toHaveLength(4);
    const byeMatches = r1.filter((m) =>
      m.player1.id === 'BYE' || m.player2.id === 'BYE'
    );
    expect(byeMatches.length).toBeGreaterThan(0);
  });

  test('R2 及以后用 TBD 占位', () => {
    const r = generateKnockout(regs(['a', 'b', 'c', 'd']), 'single');
    const r2 = r.filter((m) => m.round === 2);
    expect(r2).toHaveLength(1);
    expect(r2[0].player1.id).toBe('TBD');
    expect(r2[0].player2.id).toBe('TBD');
  });

  test('matchId 唯一', () => {
    const r = generateKnockout(regs(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), 'single');
    const ids = r.map((m) => m.matchId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('每场带 type / position / status', () => {
    const r = generateKnockout(regs(['a', 'b', 'c', 'd']), 'single');
    r.forEach((m) => {
      expect(m.type).toBe('singles');
      expect(m.position).toBeGreaterThan(0);
      expect(m.status).toBe('pending');
      expect(m.player1.id).toBeDefined();
      expect(m.player2.id).toBeDefined();
    });
  });

  test('未指定 seed 时按报名顺序兜底', () => {
    const noSeed = ['a', 'b', 'c', 'd'].map((id) => ({
      _id: `reg_${id}`,
      playerId: id,
      playerName: id.toUpperCase(),
      type: 'singles'
    }));
    const r = generateKnockout(noSeed, 'single');
    expect(r.filter((m) => m.round === 1)).toHaveLength(2);
  });

  test('双打：4 队 → R1 2 场，每场 player1/player2 带 partnerId', () => {
    const doublesRegs = [
      { _id: 'r1', playerId: 'a', playerName: 'A', partnerId: 'ap', partnerName: 'AP', teamName: 'T1', seed: 1, type: 'doubles' },
      { _id: 'r2', playerId: 'b', playerName: 'B', partnerId: 'bp', partnerName: 'BP', teamName: 'T2', seed: 2, type: 'doubles' },
      { _id: 'r3', playerId: 'c', playerName: 'C', partnerId: 'cp', partnerName: 'CP', teamName: 'T3', seed: 3, type: 'doubles' },
      { _id: 'r4', playerId: 'd', playerName: 'D', partnerId: 'dp', partnerName: 'DP', teamName: 'T4', seed: 4, type: 'doubles' }
    ];
    const r = generateKnockout(doublesRegs, 'single');
    const r1 = r.filter((m) => m.round === 1);
    expect(r1).toHaveLength(2);
    r1.forEach((m) => {
      expect(m.type).toBe('doubles');
      expect(m.player1.partnerId).toBeDefined();
      expect(m.player2.partnerId).toBeDefined();
    });
  });
});
