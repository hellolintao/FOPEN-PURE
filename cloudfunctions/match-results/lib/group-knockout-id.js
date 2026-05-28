// Keep these pure id helpers in sync with cloudfunctions/tournament-brackets/lib/group-knockout.js.
// Match-results is packaged as a separate WeChat cloud function, so production code must not require sibling cloud-function folders.
function normalizeTournamentId(tournamentId) {
  return String(tournamentId || '').replace(/^tournament_/, '')
}

function knockoutBracketDocId(tournamentId, round) {
  return `bracket_${normalizeTournamentId(tournamentId)}_knockout_round_${round}`
}

function bracketDocId(tournamentId, round, stage) {
  if (stage === 'knockout') return knockoutBracketDocId(tournamentId, round)
  return `bracket_${normalizeTournamentId(tournamentId)}_round_${round}`
}

module.exports = {
  normalizeTournamentId,
  knockoutBracketDocId,
  bracketDocId
}
