const db = wx.cloud.database()
const { syncTabBar } = require('../../utils/tab-bar')
const { decorateTournamentStatus } = require('../../utils/tournament-status')
const { PHASE, derivePhase, isActiveRegistration } = require('../../utils/tournament-phase')
const { getCacheEntry, isFresh, removeCache, setCache } = require('../../utils/page-cache')
const app = getApp()

const MATCH_CACHE_TTL_MS = 60 * 1000

Page({
	data: {
		tournaments: [],
		loading: true
	},
	onLoad() {
		this.loadTournaments()
	},
	onShow() {
		syncTabBar(this, '/pages/match/index')
		this.loadTournaments()
	},
	async loadTournaments() {
		try {
			await this.ensureIdentity()
			const cacheKey = this._tournamentsCacheKey()
			const dirtyState = this._consumeTournamentListDirtyState()
			const cached = getCacheEntry(cacheKey)
			const cachedTournaments = cached && cached.value && Array.isArray(cached.value.tournaments)
				? cached.value.tournaments
				: null
			if (cachedTournaments) {
				const visibleTournaments = dirtyState.deletedTournamentId
					? cachedTournaments.filter(tournament => tournament && tournament._id !== dirtyState.deletedTournamentId)
					: cachedTournaments
				this.setData({ tournaments: sortTournamentsByCreateTimeDesc(visibleTournaments), loading: false })
				if (!dirtyState.dirty && isFresh(cached)) return
				removeCache(cacheKey)
			} else {
				this.setData({ loading: true })
			}

			const result = await db.collection('tournaments').get()
			const tournaments = sortTournamentsByCreateTimeDesc(await this.decorateTournamentPermissions(result.data || []))
			this.setData({ tournaments, loading: false })
			setCache(cacheKey, { tournaments }, { ttlMs: MATCH_CACHE_TTL_MS })
		} catch (err) {
			console.error('获取赛事失败:', err)
			this.setData({ loading: false })
		}
	},
	_tournamentsCacheKey() {
		const globalData = (app && app.globalData) || {}
		const member = globalData.currentMember || {}
		const role = globalData.isAdmin ? 'admin' : 'member'
		return `match:tournaments:v1:${role}:${member._id || 'guest'}`
	},
	_consumeTournamentListDirtyState() {
		const globalData = (app && app.globalData) || {}
		const state = {
			dirty: !!globalData.tournamentListDirty,
			deletedTournamentId: globalData.deletedTournamentId || ''
		}
		if (state.dirty || state.deletedTournamentId) {
			globalData.tournamentListDirty = false
			globalData.deletedTournamentId = ''
		}
		return state
	},
	async ensureIdentity() {
		try {
			if (app.globalData && !app.globalData.currentMember && typeof app.refreshIdentity === 'function') {
				await app.refreshIdentity()
			}
		} catch (err) {
			console.warn('[match] refresh identity failed', err)
		}
	},
	async decorateTournamentPermissions(tournaments) {
		const isAdmin = !!(app.globalData && app.globalData.isAdmin)
		const currentMember = app.globalData && app.globalData.currentMember
		let participantTournamentIds = new Set()
		if (!isAdmin && currentMember && currentMember._id) {
			participantTournamentIds = await this.loadParticipantTournamentIds(tournaments, currentMember._id)
		}
		const resultSummaryMap = await this.loadTournamentResultSummaryMap(tournaments)
		return (tournaments || []).map(tournament => {
			const resultSummary = resultSummaryMap[tournament._id]
			const phase = derivePhase(tournament, { resultSummary })
			const permissionKind = isAdmin
				? 'admin'
				: (participantTournamentIds.has(tournament._id) ? 'participant' : 'viewer')
			return decorateTournamentStatus({
				...tournament,
				resultSummary,
				__permissionKind: permissionKind,
				__permissionLabel: permissionLabel(permissionKind, phase, permissionKind === 'participant')
			})
		})
	},
	async loadTournamentResultSummaryMap(tournaments) {
		const pairs = await Promise.all((tournaments || []).map(async tournament => {
			if (!tournament || !tournament._id || ['draft', 'completed', 'settled', 'cancelled'].includes(tournament.status)) return [tournament && tournament._id, null]
			try {
				const res = await wx.cloud.callFunction({
					name: 'match-results',
					data: { action: 'listByTournament', tournamentId: tournament._id }
				})
				const rows = unpackMatchResultRows(res)
				return [tournament._id, buildResultSummary(rows)]
			} catch (err) {
				console.warn('[match] load result summary failed', tournament._id, err)
				return [tournament._id, null]
			}
		}))
		return pairs.reduce((acc, pair) => {
			if (pair && pair[0]) acc[pair[0]] = pair[1]
			return acc
		}, {})
	},
	async loadParticipantTournamentIds(tournaments, memberId) {
		const ids = new Set()
		await Promise.all((tournaments || []).map(async tournament => {
			if (!tournament || !tournament._id) return
			try {
				const res = await wx.cloud.callFunction({
					name: 'tournament-registrations',
					data: { action: 'list', tournamentId: tournament._id, pageSize: 200 }
				})
				const rows = unpackRegistrationRows(res)
				const joined = rows.some(row => isActiveRegistration(row) && (row.playerId === memberId || row.partnerId === memberId))
				if (joined) ids.add(tournament._id)
			} catch (err) {
				console.warn('[match] load registrations failed', tournament._id, err)
			}
		}))
		return ids
	},
	onItemTap(e) {
		const { id } = e.currentTarget.dataset
		wx.navigateTo({
			url: `/pages/tournament-detail/index?id=${id}`
		})
	}
})

function permissionLabel(kind, phase, isParticipant) {
	if (kind === 'admin') {
		if (phase === PHASE.PENDING_SCHEDULE) return '待排程'
		return '可编辑'
	}
	if (isParticipant && phase === PHASE.PENDING_SCHEDULE) return '等待赛程'
	if (isParticipant) return phase === PHASE.LEGACY ? '可录分' : '已报名'
	if (phase === PHASE.REGISTRATION_OPEN) return '可报名'
	if (phase === PHASE.SCHEDULE_PUBLISHED) return '可录分'
	return '仅查看'
}

function sortTournamentsByCreateTimeDesc(tournaments) {
	return (tournaments || [])
		.map((tournament, index) => ({
			tournament,
			index,
			createdAt: tournamentCreateTimestamp(tournament)
		}))
		.sort((a, b) => {
			if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
			return a.index - b.index
		})
		.map(item => item.tournament)
}

function tournamentCreateTimestamp(tournament) {
	if (!tournament) return Number.NEGATIVE_INFINITY
	return timestampValue(
		tournament.createTime ||
		tournament.createdAt ||
		tournament.createDate ||
		tournament.createdTime ||
		tournament._createTime
	)
}

function timestampValue(value) {
	if (!value) return Number.NEGATIVE_INFINITY
	if (value instanceof Date) return value.getTime()
	if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY
	if (typeof value === 'string') {
		const parsed = new Date(value).getTime()
		return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
	}
	if (typeof value === 'object') {
		if (typeof value.toDate === 'function') return timestampValue(value.toDate())
		return timestampValue(value.$date || value.date || value.timestamp || value.seconds)
	}
	return Number.NEGATIVE_INFINITY
}

function unpackRegistrationRows(res) {
	const data = res && res.result && res.result.data
	if (Array.isArray(data)) return data
	if (data && Array.isArray(data.registrations)) return data.registrations
	if (data && Array.isArray(data.items)) return data.items
	return []
}

function unpackMatchResultRows(res) {
	const data = res && res.result && res.result.data
	if (data && Array.isArray(data.results)) return data.results
	if (Array.isArray(data)) return data
	return []
}

function buildResultSummary(rows) {
	const playable = (rows || []).filter(row => row && !isNoScoreResult(row) && !row.bye && row.player1 && row.player2 && row.player1.id && row.player2.id)
	return {
		playableCount: playable.length,
		confirmedCount: playable.filter(row => row.resultStatus === 'confirmed').length
	}
}
function isNoScoreResult(row) {
	return !!row && (
		row.noScore === true
		|| row.voided === true
		|| row.resultStatus === 'voided'
		|| row.status === 'cancelled'
		|| row.status === 'voided'
		|| (row.pointsAwarded && row.pointsAwarded.source === 'voided')
		|| isCompatibilityNoScoreResult(row)
	)
}

function isCompatibilityNoScoreResult(row) {
	const entries = row && row.pointsAwarded && row.pointsAwarded.entries
	return !!(
		row &&
		row.player1 &&
		row.player2 &&
		row.player1.id &&
		row.player2.id &&
		row.resultStatus === 'confirmed' &&
		row.status === 'completed' &&
		row.pointsAwarded &&
		row.pointsAwarded.source === 'match' &&
		Array.isArray(entries) &&
		entries.length === 0 &&
		!row.score &&
		!(row.winner && row.winner.id) &&
		!row.winnerId
	)
}
