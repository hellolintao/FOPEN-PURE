function calculatePoints(match, tournament) {
  const r = tournament.pointsRules;
  let winnerTotal, loserTotal;

  if (match.walkover) {
    winnerTotal = r.walkover;
    loserTotal = 0;
  } else {
    winnerTotal = r.win;
    loserTotal = r.loss;
  }

  if (tournament.format === 'knockout') {
    const bonus = (r.bonusByRound && r.bonusByRound[match.round]) || 0;
    winnerTotal += bonus;
  }

  return {
    winner: { base: r.win, bonus: winnerTotal - r.win, total: winnerTotal },
    loser: { base: r.loss, bonus: 0, total: loserTotal }
  };
}

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function isPointValid(matchMeta, currentSeasonId, now = new Date()) {
  if (matchMeta.format === 'regular') {
    return matchMeta.seasonId === currentSeasonId;
  }
  if (matchMeta.format === 'knockout') {
    const created = new Date(matchMeta.createTime).getTime();
    return now.getTime() - created <= ONE_YEAR_MS;
  }
  return false;
}

module.exports = { calculatePoints, isPointValid };
