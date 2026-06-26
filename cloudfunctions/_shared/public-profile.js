const DEFAULT_PUBLIC_AVATAR_URL = '/images/icons/default-avatar.png'

function hasPublicProfileConsent(member) {
  return !!(member && member.publicProfileConsent === true)
}

function anonymousProfileName(options = {}) {
  const rank = Number(options.rank)
  const index = Number(options.index)
  const ordinal = Number.isFinite(rank) && rank > 0
    ? rank
    : (Number.isFinite(index) && index >= 0 ? index + 1 : null)

  if (ordinal) return `选手${String(ordinal).padStart(2, '0')}`
  return '匿名选手'
}

function toPublicIdentity(member, options = {}) {
  const visible = hasPublicProfileConsent(member)
  if (visible) {
    return {
      name: member.name || anonymousProfileName(options),
      avatarUrl: member.avatarUrl || DEFAULT_PUBLIC_AVATAR_URL,
      publicProfileVisible: true
    }
  }

  return {
    name: anonymousProfileName(options),
    avatarUrl: DEFAULT_PUBLIC_AVATAR_URL,
    publicProfileVisible: false
  }
}

module.exports = {
  DEFAULT_PUBLIC_AVATAR_URL,
  anonymousProfileName,
  hasPublicProfileConsent,
  toPublicIdentity
}
