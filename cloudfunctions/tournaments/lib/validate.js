function validateCourtTimeGrid(grid) {
  const errors = [];
  if (grid == null) return { valid: true, errors };

  if (grid.matchDuration !== 20) {
    errors.push('matchDuration 必须是 20 分钟');
  }
  if (!Array.isArray(grid.courts)) {
    errors.push('courts 必须是数组');
    return { valid: false, errors };
  }
  if (!Array.isArray(grid.slots)) {
    errors.push('slots 必须是数组');
    return { valid: false, errors };
  }

  const courtIdSet = new Set(grid.courts.map(c => c.courtId));
  grid.slots.forEach((slot, i) => {
    if (!Array.isArray(slot.availableCourtIds)) {
      errors.push(`slots[${i}].availableCourtIds 必须是数组`);
      return;
    }
    for (const cid of slot.availableCourtIds) {
      if (!courtIdSet.has(cid)) {
        errors.push(`slots[${i}].availableCourtIds 引用了未知 court: ${cid}`);
      }
    }
  });

  return { valid: errors.length === 0, errors };
}

module.exports = { validateCourtTimeGrid };
