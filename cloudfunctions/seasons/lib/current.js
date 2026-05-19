function toTime(dateLike) {
  if (!dateLike) return NaN
  const time = new Date(dateLike).getTime()
  return Number.isFinite(time) ? time : NaN
}

function coversDate(season, targetTime) {
  const start = toTime(season && season.startDate)
  const end = toTime(season && season.endDate)
  if (!Number.isFinite(targetTime) || !Number.isFinite(start)) return false
  if (!Number.isFinite(end)) return targetTime >= start
  return targetTime >= start && targetTime <= end
}

function latestStartTime(season) {
  const time = toTime(season && season.startDate)
  return Number.isFinite(time) ? time : -Infinity
}

function compareLatestStart(a, b) {
  return latestStartTime(b) - latestStartTime(a)
}

function selectCurrentSeason(seasons, targetDate) {
  const rows = Array.isArray(seasons) ? seasons.filter(Boolean) : []
  if (rows.length === 0) return null

  const targetTime = toTime(targetDate)
  const covering = rows.filter(season => coversDate(season, targetTime))
  if (covering.length > 0) {
    return covering.sort((a, b) => {
      if ((a.status === 'active') !== (b.status === 'active')) {
        return a.status === 'active' ? -1 : 1
      }
      return compareLatestStart(a, b)
    })[0]
  }

  const active = rows.filter(season => season.status === 'active')
  if (active.length > 0) return active.sort(compareLatestStart)[0]

  return rows.sort(compareLatestStart)[0] || null
}

module.exports = { selectCurrentSeason }
