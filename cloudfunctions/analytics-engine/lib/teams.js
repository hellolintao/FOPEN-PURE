function sideMembers(side) {
  if (!side) return []
  const out = []
  const id = side.id || side.memberId || side.playerId || side._id
  if (id) out.push({ memberId: id, name: side.name || id })
  if (side.partnerId) out.push({ memberId: side.partnerId, name: side.partnerName || side.partnerId })
  return out
}

function sideHasMember(side, memberId) {
  return sideMembers(side).some(member => member.memberId === memberId)
}

function subjectSide(row, memberId) {
  if (sideHasMember(row && row.player1, memberId)) return row.player1
  if (sideHasMember(row && row.player2, memberId)) return row.player2
  return null
}

function opponentSide(row, memberId) {
  if (sideHasMember(row && row.player1, memberId)) return row.player2 || null
  if (sideHasMember(row && row.player2, memberId)) return row.player1 || null
  return null
}

function teamLabel(members) {
  const names = (members || []).map(member => member.name || member.memberId).filter(Boolean)
  return names.join(' / ')
}

function resultRoleForMember(row, memberId) {
  const entries = (row && row.pointsAwarded && row.pointsAwarded.entries) || []
  const hit = entries.find(entry => entry.memberId === memberId)
  return hit && hit.role ? hit.role : null
}

module.exports = { sideMembers, sideHasMember, subjectSide, opponentSide, teamLabel, resultRoleForMember }
