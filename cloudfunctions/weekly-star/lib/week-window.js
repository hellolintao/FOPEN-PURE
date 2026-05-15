function pad(n) {
  return String(n).padStart(2, '0')
}

function toDateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function startOfLocalDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function getPreviousNaturalWeek(now = new Date()) {
  const today = startOfLocalDay(now)
  const dow = today.getDay() === 0 ? 7 : today.getDay()
  const thisMonday = new Date(today)
  thisMonday.setDate(today.getDate() - (dow - 1))

  const start = new Date(thisMonday)
  start.setDate(thisMonday.getDate() - 7)

  const end = new Date(thisMonday)
  end.setMilliseconds(-1)

  return {
    start,
    end,
    weekStart: toDateKey(start),
    weekEnd: toDateKey(end),
    weekId: getWeekId(start)
  }
}

function getWeekId(mondayDate) {
  return `ws_${toDateKey(mondayDate)}`
}

module.exports = { getPreviousNaturalWeek, getWeekId, toDateKey }
