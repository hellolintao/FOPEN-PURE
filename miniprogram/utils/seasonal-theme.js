function isPrideMonthSkinActive(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return false
  return date.getFullYear() === 2026 && date.getMonth() === 5
}

module.exports = {
  isPrideMonthSkinActive
}
