// Legacy courtTimeGrid validator is kept for backward compatibility with old code paths.
const TOURNAMENT_TYPES = ['singles', 'doubles', 'mixed'];
const SCHEDULE_STATUSES = ['none', 'draft', 'published'];

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
  if (sp.slotMinutes !== 20) errors.push('schedulePlan.slotMinutes 必须固定为 20');
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

/**
 * Validate tournament payload.
 * isDraft=true: only require minimal fields.
 * isDraft=false: full validation, except scheduleStatus none/draft may defer schedulePlan.
 * @param {object} data
 * @param {{ isDraft: boolean }} opts
 * @returns {string[]}
 */
function validateTournament(data = {}, { isDraft = false } = {}) {
  const errors = [];

  if (!data.name || data.name.trim() === '') errors.push('赛事名称不能为空');
  if (!data.type || !TOURNAMENT_TYPES.includes(data.type)) {
    errors.push('赛事类型必须是 singles、doubles 或 mixed');
  }
  if (!data.format || !['regular', 'knockout'].includes(data.format)) {
    errors.push('赛制必须是 regular(常规赛) 或 knockout(淘汰赛)');
  }
  if (data.format === 'knockout' && data.type === 'mixed') {
    errors.push('淘汰赛不支持 mixed 类型');
  }
  if (!data.startDate) errors.push('开始日期不能为空');
  if (!data.seasonId) errors.push('所属赛季不能为空');

  if (data.scheduleStatus !== undefined && !SCHEDULE_STATUSES.includes(data.scheduleStatus)) {
    errors.push('scheduleStatus 必须是 none、draft 或 published');
  }
  if (data.scheduleNeedsRevision !== undefined && typeof data.scheduleNeedsRevision !== 'boolean') {
    errors.push('scheduleNeedsRevision 必须是布尔值');
  }

  if (data.startDate && data.endDate) {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (start > end) errors.push('结束日期不能早于开始日期');
  }

  if (isDraft) return errors;

  if (shouldValidateSchedulePlan(data)) {
    errors.push(...validateSchedulePlan(data.schedulePlan));
  }

  errors.push(...validatePointsRules(data.pointsRules));

  if (data.format === 'knockout') {
    const max = data.maxPlayers;
    if (!max || max < 2) errors.push('淘汰赛 maxPlayers 不能小于 2');
  }

  return errors;
}

function shouldValidateSchedulePlan(data) {
  return data.scheduleStatus !== 'none' && data.scheduleStatus !== 'draft';
}

module.exports = {
  validateCourtTimeGrid,
  validateSchedulePlan,
  validatePointsRules,
  validateTournament
};
