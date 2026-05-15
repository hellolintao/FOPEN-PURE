// score-row · Phase 8 Task 9
// 单场比分行：折叠展示 + 展开内联编辑器
//
// properties:
//   match: match_results 行（含 sourceMatchId, player1, player2, score, resultStatus, bye, matchKind, round）
//   isAdmin: Boolean
// events:
//   submit({ matchId, score })   — 普通提交 / admin 首次确认
//   reconfirm({ matchId, newScore }) — admin 修改已 confirmed 行（二次确认弹窗后触发）

const { validateScore } = require('../../utils/score-rule.js')

Component({
  properties: {
    match: {
      type: Object,
      value: null,
      observer(m) {
        this._hydrateDraft(m)
        this._recomputeFlags(m, this.data.isAdmin)
      }
    },
    isAdmin: {
      type: Boolean,
      value: false,
      observer(v) {
        this._recomputeFlags(this.data.match, v)
      }
    }
  },

  data: {
    expanded: false,
    draftA: 0,
    draftB: 0,
    draftTb: '',
    validationError: '',
    filled: false,
    dirty: false,
    submitDisabled: false,
    originalScoreKey: '',
    isDoubles: false,
    isBye: false,
    isMissingPlayer: false,
    canEdit: false,
    statusLabel: '',
    submitLabel: '',
    showTbInput: false
  },

  methods: {
    _hydrateDraft(m) {
      if (m && m.score && Array.isArray(m.score.sets) && m.score.sets[0]) {
        const s0 = m.score.sets[0]
        const a = Number.isInteger(s0.a) ? s0.a : 0
        const b = Number.isInteger(s0.b) ? s0.b : 0
        const tb = m.score.tiebreak || ''
        const originalScoreKey = this._scoreKey({ sets: [{ a, b }], tiebreak: tb || null })
        this.setData({ draftA: a, draftB: b, draftTb: tb, showTbInput: a === 3 && b === 3, originalScoreKey })
        this.revalidate()
      } else {
        this.setData({ draftA: 0, draftB: 0, draftTb: '', showTbInput: false, validationError: '', originalScoreKey: '' })
        this.revalidate()
      }
    },

    _recomputeFlags(m, isAdmin) {
      if (!m) {
        this.setData({ canEdit: false })
        return
      }
      const isBye = !!m.bye
      const isMissingPlayer = !m.player1 || !m.player2 || !m.player1.id || !m.player2.id
      const isConfirmed = m.resultStatus === 'confirmed'
      const isDoubles = !!(m.player1 && m.player1.partnerId)
      // 普通会员可编辑所有未确认比赛；管理员可修改已确认比赛，但未改动时确认按钮置灰。
      let canEdit
      if (isBye || isMissingPlayer) canEdit = false
      else if (isConfirmed) canEdit = !!isAdmin
      else canEdit = true
      const statusLabel = isBye ? '轮空'
        : isMissingPlayer ? '未开打'
        : isConfirmed ? '已确认'
        : m.resultStatus === 'submitted' ? '待确认'
        : '待录入'
      const submitLabel = '确认'
      this.setData({ isDoubles, isBye, isMissingPlayer, canEdit, statusLabel, submitLabel })
      this.revalidate()
    },

    onToggle() {
      if (!this.data.canEdit) return
      this.setData({ expanded: !this.data.expanded })
    },

    onIncA() {
      const v = Math.min(4, Math.max(0, this.data.draftA + 1))
      this.setData({ draftA: v, showTbInput: v === 3 && this.data.draftB === 3 })
      this.revalidate()
    },
    onDecA() {
      const v = Math.min(4, Math.max(0, this.data.draftA - 1))
      this.setData({ draftA: v, showTbInput: v === 3 && this.data.draftB === 3 })
      this.revalidate()
    },
    onIncB() {
      const v = Math.min(4, Math.max(0, this.data.draftB + 1))
      this.setData({ draftB: v, showTbInput: v === 3 && this.data.draftA === 3 })
      this.revalidate()
    },
    onDecB() {
      const v = Math.min(4, Math.max(0, this.data.draftB - 1))
      this.setData({ draftB: v, showTbInput: v === 3 && this.data.draftA === 3 })
      this.revalidate()
    },

    onTbInput(e) {
      this.setData({ draftTb: e.detail.value })
      this.revalidate()
    },

    revalidate() {
      const { draftA, draftB, draftTb } = this.data
      const tb = (draftA === 3 && draftB === 3) ? (draftTb || null) : null
      const r = validateScore(draftA, draftB, tb)
      const score = { sets: [{ a: draftA, b: draftB }], tiebreak: tb }
      const scoreKey = this._scoreKey(score)
      const filled = r.valid
      const dirty = scoreKey !== (this.data.originalScoreKey || '')
      const isConfirmed = this.data.match && this.data.match.resultStatus === 'confirmed'
      const submitDisabled = !filled || (isConfirmed && this.data.isAdmin && !dirty)
      this.setData({
        validationError: r.valid ? '' : this._friendlyError(r.error),
        filled,
        dirty,
        submitDisabled
      })
      this._emitDraft(score, filled, dirty)
    },

    _scoreKey(score) {
      const s0 = score && score.sets && score.sets[0]
      if (!s0) return ''
      return `${s0.a}:${s0.b}:${score.tiebreak || ''}`
    },

    _emitDraft(score, filled, dirty) {
      const m = this.data.match
      if (!m || !m.sourceMatchId) return
      this.triggerEvent('draftchange', {
        matchId: m.sourceMatchId,
        score,
        filled,
        dirty,
        resultStatus: m.resultStatus || 'pending',
        canEdit: this.data.canEdit,
        isConfirmed: m.resultStatus === 'confirmed'
      })
    },

    _friendlyError(code) {
      switch (code) {
        case 'NEG': return '比分不能为负'
        case 'UNDER_4': return '至少一方需达 4 局'
        case 'OVER_4': return '单方不能超过 4 局'
        case 'NEED_TB': return '3:3 时填抢七比分；4:3 不允许直接录'
        case 'TB_REQUIRED': return '3:3 需填抢七比分（如 7-5）'
        case 'TB_FORMAT': return '抢七格式为 X-Y（数字）'
        case 'TB_UNDER_7': return '抢七至少有一方 ≥ 7'
        case 'TB_DIFF': return '抢七必须领先 2 分'
        case '4_4': return '4:4 不合法'
        default: return '比分不合法'
      }
    },

    onSubmit() {
      const { draftA, draftB, draftTb } = this.data
      const tb = (draftA === 3 && draftB === 3) ? (draftTb || null) : null
      const r = validateScore(draftA, draftB, tb)
      if (!r.valid) {
        wx.showToast({ title: this._friendlyError(r.error), icon: 'none' })
        return
      }
      const m = this.data.match
      if (!m) return
      const score = { sets: [{ a: draftA, b: draftB }], tiebreak: tb }
      const matchId = m.sourceMatchId
      if (this.data.submitDisabled) return

      if (m.resultStatus === 'confirmed' && this.data.isAdmin) {
        // 二次确认
        wx.showModal({
          title: '修改已确认的比分？',
          content: '若 winner 变化，将清空后续轮次结果与名次积分',
          success: ({ confirm }) => {
            if (confirm) this.triggerEvent('reconfirm', { matchId, newScore: score })
          }
        })
      } else {
        this.triggerEvent('submit', { matchId, score })
      }
    },

    stopBubble() {
      // 阻止编辑区点击折叠行
    }
  }
})
