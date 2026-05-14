// Legacy validator — kept for backward compatibility with old code paths.
// New code should use validateSchedulePlan / validatePointsRules instead.
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

/**
 * Validate the new schedulePlan data model (Phase 7+).
 * Returns an array of error strings (empty = valid).
 * @param {object} sp
 * @returns {string[]}
 */
function validateSchedulePlan(sp) {
  const errors = [];
  if (!sp || typeof sp !== 'object') return ['schedulePlan 必填'];
  if (sp.slotMinutes !== 30) errors.push('schedulePlan.slotMinutes 必须固定为 30');
  if (!Array.isArray(sp.courts) || sp.courts.length === 0) {
    errors.push('schedulePlan.courts 不能为空');
  } else {
    const seen = new Set();
    sp.courts.forEach((c, i) => {
      if (!c.courtId) errors.push(`schedulePlan.courts[${i}].courtId 必填`);
      else if (seen.has(c.courtId)) errors.push('schedulePlan.courts.courtId 重复');
      else seen.add(c.courtId);
      if (!c.name) errors.push(`schedulePlan.courts[${i}].name 必填`);
      if (!Array.isArray(c.slots) || c.slots.length === 0) {
        errors.push(`schedulePlan.courts[${i}].slots 不能为空`);
      }
    });
  }
  return errors;
}

/**
 * Validate the new pointsRules data model (Phase 7+).
 * Returns an array of error strings (empty = valid).
 * @param {object} pr
 * @returns {string[]}
 */
function validatePointsRules(pr) {
  const errors = [];
  if (!pr || typeof pr !== 'object') return ['pointsRules 必填'];
  if (!pr.winLoss) {
    errors.push('pointsRules.winLoss 必填');
  } else {
    ['win', 'loss', 'walkover'].forEach(k => {
      if (typeof pr.winLoss[k] !== 'number') errors.push(`pointsRules.winLoss.${k} 必须是数字`);
    });
  }
  if (!pr.placement) {
    errors.push('pointsRules.placement 必填');
  } else {
    ['champion', 'runnerUp', 'semifinal', 'quarterfinal', 'participation'].forEach(k => {
      if (typeof pr.placement[k] !== 'number') errors.push(`pointsRules.placement.${k} 必须是数字`);
    });
  }
  return errors;
}

module.exports = { validateCourtTimeGrid, validateSchedulePlan, validatePointsRules };
