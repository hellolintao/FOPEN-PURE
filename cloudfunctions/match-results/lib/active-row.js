function isActiveScoreRow(row) {
  if (!row) return false
  if (row.resultStatus === 'invalidated') return false
  if (row.matchKind === 'history' || row.matchKind === 'audit') return false
  if (row.archivedFrom) return false
  return true
}

module.exports = { isActiveScoreRow }
