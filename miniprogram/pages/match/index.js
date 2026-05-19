const db = wx.cloud.database()
const { syncTabBar } = require('../../utils/tab-bar')
const { decorateTournamentStatus } = require('../../utils/tournament-status')
const app = getApp()

Page({
	data: {
		tournaments: []
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
			const result = await db.collection('tournaments').get()
			const tournaments = await this.decorateTournamentPermissions(result.data || [])
			this.setData({ tournaments })
		} catch (err) {
			console.error('获取赛事失败:', err)
		}
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
			const permissionKind = isAdmin
				? 'admin'
				: (participantTournamentIds.has(tournament._id) ? 'participant' : 'viewer')
			return decorateTournamentStatus({
				...tournament,
				resultSummary: resultSummaryMap[tournament._id],
				__permissionKind: permissionKind,
				__permissionLabel: permissionLabel(permissionKind)
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

function permissionLabel(kind) {
	if (kind === 'admin') return '可编辑'
	if (kind === 'participant') return '可录分'
	return '仅查看'
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
	const playable = (rows || []).filter(row => row && !row.bye && row.player1 && row.player2 && row.player1.id && row.player2.id)
	return {
		playableCount: playable.length,
		confirmedCount: playable.filter(row => row.resultStatus === 'confirmed').length
	}
}

function isActiveRegistration(row) {
	return !!row && row.status !== 'cancelled' && row.registrationStatus !== 'cancelled'
}
