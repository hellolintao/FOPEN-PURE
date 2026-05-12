const VALID_RESULT_STATUS = ['pending', 'confirmed', 'disputed'];

function validateResultSubmission(s) {
  const errors = [];
  if (!s.submittedBy) errors.push('submittedBy 不能为空');
  if (!['admin', 'player'].includes(s.role)) {
    errors.push('role 必须是 admin 或 player');
  }
  if (!s.winnerIds) errors.push('winnerIds 不能为空');
  if (s.score != null && typeof s.score === 'string' && s.score.length > 50) {
    errors.push('score 不能超过 50 字符');
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { validateResultSubmission, VALID_RESULT_STATUS };
