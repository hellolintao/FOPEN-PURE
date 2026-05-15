function createMatchStateService({ db, awardLib, scoreRule }) {
  async function submitResult({ matchId, score, submitter }) {
    if (!submitter || !submitter._id) throw new Error('UNAUTHORIZED')
    const sets0 = score && score.sets && score.sets[0]
    if (!sets0) throw new Error('INVALID_SCORE')
    const v = scoreRule.validateScore(sets0.a, sets0.b, score.tiebreak || null)
    if (!v.valid) throw new Error('INVALID_SCORE')

    const result = await findResultByMatchId(matchId)
    if (!result) throw new Error('NOT_FOUND')

    // 修订 #1: confirmed 行普通会员不得改
    if (result.resultStatus === 'confirmed' && !submitter.isAdmin) {
      throw new Error('UNAUTHORIZED')
    }
    // 选手端：赛事参赛选手可提交本赛事任意比赛结果；管理员确认后不可再由选手覆盖。
    if (!submitter.isAdmin && !(await isTournamentParticipant(result, submitter._id))) {
      throw new Error('UNAUTHORIZED')
    }

    const tournament = await getTournament(result.tournamentId)
    const winner = scoreRule.computeWinner(
      { player1: result.player1, player2: result.player2 },
      { a: sets0.a, b: sets0.b, tiebreak: score.tiebreak || null }
    )

    if (submitter.isAdmin) {
      await confirmOne(result, tournament, score, winner, submitter)
      await maybeAwardPlacement(tournament._id)
    } else {
      await removeResultFields(result._id, ['score'])
      await db.collection('match_results').doc(result._id).update({
        data: { score, resultStatus: 'submitted' }
      })
    }
  }

  async function confirmAll({ tournamentId, admin }) {
    if (!admin || !admin.isAdmin) throw new Error('UNAUTHORIZED')
    const submitted = (await db.collection('match_results').where({ tournamentId, resultStatus: 'submitted' }).get()).data
    let count = 0
    const tournament = await getTournament(tournamentId)
    for (const r of submitted) {
      const sets0 = r.score && r.score.sets && r.score.sets[0]
      if (!sets0) continue
      const winner = scoreRule.computeWinner(
        { player1: r.player1, player2: r.player2 },
        { a: sets0.a, b: sets0.b, tiebreak: (r.score && r.score.tiebreak) || null }
      )
      await confirmOne(r, tournament, r.score, winner, admin)
      count++
    }
    await maybeAwardPlacement(tournamentId)
    return { confirmedCount: count }
  }

  async function reconfirmMatch({ matchId, newScore, admin }) {
    if (!admin || !admin.isAdmin) throw new Error('UNAUTHORIZED')
    const result = await findResultByMatchId(matchId)
    if (!result) throw new Error('NOT_FOUND')
    const sets0 = newScore && newScore.sets && newScore.sets[0]
    if (!sets0) throw new Error('INVALID_SCORE')
    const v = scoreRule.validateScore(sets0.a, sets0.b, newScore.tiebreak || null)
    if (!v.valid) throw new Error('INVALID_SCORE')
    const tournament = await getTournament(result.tournamentId)
    const oldWinnerId = result.winner && result.winner.id
    const newWinner = scoreRule.computeWinner(
      { player1: result.player1, player2: result.player2 },
      { a: sets0.a, b: sets0.b, tiebreak: newScore.tiebreak || null }
    )

    if (result.matchKind === 'bracket' && oldWinnerId && newWinner && oldWinnerId !== newWinner.id) {
      await clearDownstream(result.tournamentId, result)
      await removeTournamentPointsByTournament(result.tournamentId)
      await db.collection('tournaments').doc(result.tournamentId).update({ data: { status: 'ongoing' } })
    }

    await confirmOne(result, tournament, newScore, newWinner, admin)
    await maybeAwardPlacement(result.tournamentId)
  }

  async function clearDownstream(tournamentId, oldMatch) {
    if (!oldMatch || !oldMatch.round) return
    const nextRound = oldMatch.round + 1
    const docId = bracketDocId(tournamentId, nextRound)
    const doc = await getDocOrNull('tournament_brackets', docId)
    if (!doc) return
    const oldPosition = oldMatch.position || 1
    const nextPosition = Math.ceil(oldPosition / 2)
    const slot = (oldPosition % 2 === 1) ? 'player1' : 'player2'
    const idx = doc.matches.findIndex(m => m.position === nextPosition)
    if (idx < 0) return
    const updated = [...doc.matches]
    updated[idx] = { ...updated[idx], [slot]: null, winner: null, status: 'pending', resultStatus: 'pending' }
    await db.collection('tournament_brackets').doc(docId).update({ data: { matches: updated } })

    const nextMatchId = updated[idx].matchId
    const prefix = tournamentId.replace('tournament_', '')
    const nextResultId = `result_${prefix}_${nextMatchId}`
    const nextResult = await getDocOrNull('match_results', nextResultId)
    if (nextResult) {
      await db.collection('match_results').doc(nextResultId).update({
        data: {
          score: null, resultStatus: 'pending', winner: null, winnerId: null,
          pointsAwarded: null, confirmedBy: null, confirmedAt: null,
          [slot]: null
        }
      })
      // 递归向下清（如果还有下一轮）
      const refreshed = await getDocOrNull('match_results', nextResultId)
      if (refreshed) {
        await clearDownstream(tournamentId, { ...refreshed, round: nextRound, position: nextPosition })
      }
    }
  }

  async function awardPlacementIfFinal(tournamentId) {
    return maybeAwardPlacement(tournamentId)
  }

  // —— internal helpers ——

  async function confirmOne(result, tournament, score, winner, admin) {
    const effectiveWinner = winner || result.winner
    const entries = awardLib.buildAwardEntries(
      { ...result, score, winner: effectiveWinner },
      tournament.pointsRules.winLoss,
      tournament.type
    )
    await removeResultFields(result._id, ['score', 'winner', 'pointsAwarded'])
    await db.collection('match_results').doc(result._id).update({
      data: {
        score,
        resultStatus: 'confirmed',
        winner: effectiveWinner,
        winnerId: effectiveWinner ? effectiveWinner.id : null,
        confirmedBy: admin._id,
        confirmedAt: new Date(),
        pointsAwarded: { source: 'match', entries }
      }
    })
    // 同步当前轮 bracket 上的 winner（供 placement 判定 final 用）
    if (result.matchKind === 'bracket') {
      const currentDocId = bracketDocId(result.tournamentId, result.round || 1)
      const curDoc = await getDocOrNull('tournament_brackets', currentDocId)
      if (curDoc) {
        const curIdx = curDoc.matches.findIndex(m => m.position === (result.position || 1))
        if (curIdx >= 0) {
          const curUpdated = [...curDoc.matches]
          curUpdated[curIdx] = {
            ...curUpdated[curIdx],
            winner: effectiveWinner,
            status: 'confirmed',
            resultStatus: 'confirmed'
          }
          await db.collection('tournament_brackets').doc(currentDocId).update({ data: { matches: curUpdated } })
        }
      }
    }

    // 推进下一轮 bracket + 同步 R+1 match_results 占位（修订 #2）
    if (result.matchKind === 'bracket' && winner) {
      const nextRound = (result.round || 1) + 1
      const docId = bracketDocId(result.tournamentId, nextRound)
      const nextDoc = await getDocOrNull('tournament_brackets', docId)
      if (nextDoc) {
        const oldPosition = result.position || 1
        const nextPosition = Math.ceil(oldPosition / 2)
        const slot = (oldPosition % 2 === 1) ? 'player1' : 'player2'
        const idx = nextDoc.matches.findIndex(m => m.position === nextPosition)
        if (idx >= 0) {
          const updated = [...nextDoc.matches]
          updated[idx] = { ...updated[idx], [slot]: winner }
          await db.collection('tournament_brackets').doc(docId).update({ data: { matches: updated } })

          // 同步 R+1 match_results 行
          const prefix = result.tournamentId.replace('tournament_', '')
          const nextMatchId = updated[idx].matchId
          const nextResultId = `result_${prefix}_${nextMatchId}`
          const nextRow = await getDocOrNull('match_results', nextResultId)
          if (nextRow) {
            const otherSlotKey = slot === 'player1' ? 'player2' : 'player1'
            const other = nextRow[otherSlotKey]
            const newPlayerIds = collectPlayerIdsFromMatch(
              { player1: slot === 'player1' ? winner : other, player2: slot === 'player1' ? other : winner },
              tournament.type
            )
            await removeResultFields(nextResultId, [slot])
            await db.collection('match_results').doc(nextResultId).update({
              data: { [slot]: winner, playerIds: newPlayerIds }
            })
          }
        }
      }
    }
  }

  async function removeResultFields(resultId, fields) {
    const command = db && db.command
    if (!command || typeof command.remove !== 'function') return
    const data = {}
    for (const field of fields || []) data[field] = command.remove()
    if (Object.keys(data).length === 0) return
    await db.collection('match_results').doc(resultId).update({
      data
    })
  }

  async function maybeAwardPlacement(tournamentId) {
    const t = await getTournament(tournamentId)
    if (!t || t.format !== 'knockout') return { skipped: true, reason: 'not_knockout' }
    const brackets = (await db.collection('tournament_brackets').where({ tournamentId }).get()).data
    const r1 = brackets.find(b => b.round === 1)
    if (!r1) return { skipped: true, reason: 'missing_r1' }
    const slots = (r1.matches || []).length * 2
    const finalRound = awardLib.finalRoundOf(slots)
    const final = brackets.find(b => b.round === finalRound)
    if (!final || !final.matches[0] || !final.matches[0].winner) return { skipped: true, reason: 'missing_final_winner', finalRound }
    const all = (await db.collection('match_results').where({ tournamentId, matchKind: 'bracket' }).get()).data
    if (all.some(r => !r.bye && r.resultStatus !== 'confirmed')) return { skipped: true, reason: 'not_all_confirmed', total: all.length }

    let entries = awardLib.buildPlacementEntries(brackets, t.pointsRules.placement, t.type)
    // 云端历史包曾出现 bracket placement 计算为空但赛事已 completed 的情况。
    // 这里用已确认 match_results 兜底，保证决赛确认后 placement 一定落库。
    if (!entries.length) entries = buildPlacementEntriesFromResults(all, t.pointsRules.placement, t.type)
    if (!entries.length) return { skipped: true, reason: 'empty_entries', total: all.length }

    await ensureCollection('tournament_points')
    const now = new Date()
    for (const e of entries) {
      const _id = `${tournamentId}_${e.memberId}_placement`
      await upsertTournamentPoint(_id, {
        tournamentId, memberId: e.memberId, seasonId: t.seasonId, tournamentType: t.type,
        points: e.points, rank: e.rank, awardedAt: now, createTime: now, updateTime: now
      })
    }
    await db.collection('tournaments').doc(tournamentId).update({ data: { status: 'completed' } })
    return { skipped: false, entriesCount: entries.length, entries }
  }


  async function upsertTournamentPoint(_id, payload) {
    const existing = await getDocOrNull('tournament_points', _id)
    if (existing) {
      const { createTime, ...rest } = payload
      await db.collection('tournament_points').doc(_id).update({ data: rest })
    } else {
      const coll = db.collection('tournament_points')
      if (coll && typeof coll.add === 'function') {
        await coll.add({ data: { _id, ...payload } })
      } else {
        const { _id: ignored, ...data } = { _id, ...payload }
        await coll.doc(_id).set({ data })
      }
    }
  }

  function buildPlacementEntriesFromResults(rows, placement, type) {
    const confirmed = (rows || []).filter(r => r && !r.bye && r.resultStatus === 'confirmed')
    if (!confirmed.length || !placement) return []
    const byRound = new Map()
    for (const r of confirmed) {
      const round = r.round || 1
      if (!byRound.has(round)) byRound.set(round, [])
      byRound.get(round).push(r)
    }
    const finalRound = Math.max(...confirmed.map(r => r.round || 1))
    const final = (byRound.get(finalRound) || []).find(r => r.winner && r.winner.id)
    if (!final) return []

    const buckets = new Map()
    const setBucket = (id, rank) => {
      if (!id || buckets.has(id)) return
      const points = placement[rank]
      if (typeof points !== 'number') return
      buckets.set(id, { memberId: id, rank, points })
    }
    const collectIds = side => {
      if (!side || !side.id) return []
      const out = [side.id]
      if (type === 'doubles' && side.partnerId) out.push(side.partnerId)
      return out
    }
    const opposite = r => {
      const winId = r.winner && r.winner.id
      if (!winId) return null
      if (r.player1 && (r.player1.id === winId || r.player1.partnerId === winId)) return r.player2
      if (r.player2 && (r.player2.id === winId || r.player2.partnerId === winId)) return r.player1
      return null
    }

    collectIds(final.winner).forEach(id => setBucket(id, 'champion'))
    collectIds(opposite(final)).forEach(id => setBucket(id, 'runnerUp'))

    const sfRound = finalRound - 1
    if (sfRound >= 1) {
      for (const r of byRound.get(sfRound) || []) collectIds(opposite(r)).forEach(id => setBucket(id, 'semifinal'))
    }
    const qfRound = finalRound - 2
    if (qfRound >= 1) {
      for (const r of byRound.get(qfRound) || []) collectIds(opposite(r)).forEach(id => setBucket(id, 'quarterfinal'))
    }
    for (const [round, matches] of byRound.entries()) {
      if (round >= finalRound - 2) continue
      for (const r of matches) collectIds(opposite(r)).forEach(id => setBucket(id, 'participation'))
    }
    return [...buckets.values()]
  }

  async function findResultByMatchId(matchId) {
    const rows = (await db.collection('match_results').where({ sourceMatchId: matchId }).get()).data
    return rows[0] || null
  }

  async function getTournament(tournamentId) {
    const res = await db.collection('tournaments').doc(tournamentId).get()
    return res.data
  }

  async function getDocOrNull(collectionName, docId) {
    try {
      const res = await db.collection(collectionName).doc(docId).get()
      return res.data || null
    } catch (e) {
      return null
    }
  }

  async function isTournamentParticipant(result, memberId) {
    const tournamentId = result && result.tournamentId
    if (!tournamentId || !memberId) return false
    const all = await db.collection('tournament_registrations')
      .where({ tournamentId })
      .get()
      .catch(() => ({ data: [] }))
    const registrations = (all.data || []).filter(r => r.registrationStatus !== 'withdrew')
    if (registrations.length === 0) return (result.playerIds || []).includes(memberId)
    if (registrations.some(r => r.playerId === memberId || r.partnerId === memberId)) return true
    const byPlayer = await db.collection('tournament_registrations')
      .where({ tournamentId, playerId: memberId })
      .get()
      .catch(() => ({ data: [] }))
    if ((byPlayer.data || []).some(r => r.registrationStatus !== 'withdrew')) return true
    const byPartner = await db.collection('tournament_registrations')
      .where({ tournamentId, partnerId: memberId })
      .get()
      .catch(() => ({ data: [] }))
    return (byPartner.data || []).some(r => r.registrationStatus !== 'withdrew')
  }

  function collectPlayerIdsFromMatch(m, type) {
    const ids = []
    if (m.player1 && m.player1.id) {
      ids.push(m.player1.id)
      if (type === 'doubles' && m.player1.partnerId) ids.push(m.player1.partnerId)
    }
    if (m.player2 && m.player2.id) {
      ids.push(m.player2.id)
      if (type === 'doubles' && m.player2.partnerId) ids.push(m.player2.partnerId)
    }
    return ids
  }

  function bracketDocId(tournamentId, round) {
    const normalized = String(tournamentId || '').replace(/^tournament_/, '')
    return `bracket_${normalized}_round_${round}`
  }

  async function ensureCollection(name) {
    if (!db || typeof db.createCollection !== 'function') return
    try {
      await db.createCollection(name)
    } catch (e) {
      // 已存在 / 权限不足等交给后续真实读写暴露；这里只解决新环境缺集合。
    }
  }

  async function removeTournamentPointsByTournament(tournamentId) {
    try {
      await db.collection('tournament_points').where({ tournamentId }).remove()
    } catch (e) {
      if (isCollectionMissing(e)) return
      throw e
    }
  }

  function isCollectionMissing(e) {
    const text = `${(e && (e.errMsg || e.message || e.code)) || ''}`
    return (e && e.errCode === -502005) || /collection not exists|Db or Table not exist|not exist/i.test(text)
  }

  return { submitResult, confirmAll, reconfirmMatch, clearDownstream, awardPlacementIfFinal }
}

module.exports = { createMatchStateService }
