const { DEFAULT_PUBLIC_AVATAR_URL, anonymousProfileName, hasPublicProfileConsent } = require('../../_shared/public-profile')

function resolveAnalyticsIdentities(doc, membersById) {
  if (!doc) return doc
  const memberIdentity = identityFor(membersById, doc.memberId, 0)
  const out = {
    ...doc,
    displayName: memberIdentity.name,
    avatarUrl: memberIdentity.avatarUrl,
    publicProfileVisible: memberIdentity.publicProfileVisible
  }
  if (out.doubles && Array.isArray(out.doubles.teamH2H)) {
    out.doubles = {
      ...out.doubles,
      teamH2H: out.doubles.teamH2H.map(row => resolveTeamH2HRow(row, membersById))
    }
  }
  if (Array.isArray(out.recentMatches)) {
    out.recentMatches = out.recentMatches.map(row => resolveRecentRow(row, membersById))
  }
  return out
}

function resolveTeamH2HRow(row, membersById) {
  const subjectTeam = resolveTeam(row.subjectTeam, membersById)
  const opponentTeam = resolveTeam(row.opponentTeam, membersById)
  return {
    ...row,
    subjectTeam,
    opponentTeam,
    subjectTeamLabel: teamLabel(subjectTeam),
    opponentTeamLabel: teamLabel(opponentTeam)
  }
}

function resolveRecentRow(row, membersById) {
  const subjectTeam = resolveTeam(row.subjectTeam, membersById)
  const opponentTeam = resolveTeam(row.opponentTeam, membersById)
  return {
    ...row,
    subjectTeam,
    opponentTeam,
    subjectTeamLabel: teamLabel(subjectTeam),
    opponentTeamLabel: teamLabel(opponentTeam)
  }
}

function resolveTeam(team, membersById) {
  return (team || []).map((member, index) => {
    const identity = identityFor(membersById, member.memberId, index)
    return {
      memberId: member.memberId,
      name: identity.name,
      avatarUrl: identity.avatarUrl,
      publicProfileVisible: identity.publicProfileVisible
    }
  })
}

function identityFor(membersById, memberId, index) {
  const member = membersById && membersById.get(memberId)
  const visible = hasPublicProfileConsent(member)
  return {
    name: visible && member && member.name ? member.name : anonymousProfileName({ index }),
    avatarUrl: visible && member && member.avatarUrl ? member.avatarUrl : DEFAULT_PUBLIC_AVATAR_URL,
    publicProfileVisible: visible
  }
}

function teamLabel(team) {
  return (team || []).map(member => member.name || member.memberId).filter(Boolean).join(' / ')
}

module.exports = { resolveAnalyticsIdentities }
