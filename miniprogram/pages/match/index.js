const db = wx.cloud.database()
const { syncTabBar } = require('../../utils/tab-bar')
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
		return (tournaments || []).map(tournament => {
			const permissionKind = isAdmin
				? 'admin'
				: (participantTournamentIds.has(tournament._id) ? 'participant' : 'viewer')
			return {
				...tournament,
				__permissionKind: permissionKind,
				__permissionLabel: permissionLabel(permissionKind)
			}
		})
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

function isActiveRegistration(row) {
	return !!row && row.status !== 'cancelled' && row.registrationStatus !== 'cancelled'
}
