const INSUFFICIENT_PLAYERS = 'INSUFFICIENT_PLAYERS'

function finalRoundOf(slots) {
  if (slots < 2) throw new Error(INSUFFICIENT_PLAYERS)
  return Math.log2(slots) | 0
}

function nextPowerOf2(n) {
  let p = 1
  while (p < n) p *= 2
  return p
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function generateFirstRound({ format, type, registrations }) {
  const N = registrations.length
  if (N < 2) throw new Error(INSUFFICIENT_PLAYERS)

  if (format === 'knockout') return generateKnockoutR1(registrations)
  if (format === 'regular') return generateRegularR1(registrations)
  throw new Error(`UNSUPPORTED_FORMAT: ${format}`)
}

function generateKnockoutR1(registrations) {
  const slots = nextPowerOf2(registrations.length)
  const shuffled = shuffle(registrations)
  const byeCount = slots - shuffled.length
  const BYE = { playerId: 'BYE', playerName: 'BYE', registrationId: null }

  // Build slot array: interleave BYEs evenly so each BYE pairs with a real player.
  // Strategy: place players in even indices, BYEs in odd indices of the last byeCount pairs.
  // Simpler: build pairs list directly — first (slots/2 - byeCount) pairs are player vs player,
  // last byeCount pairs are player vs BYE.
  const pairs = []
  let pi = 0
  const regularPairs = slots / 2 - byeCount
  for (let i = 0; i < regularPairs; i++) {
    pairs.push([shuffled[pi], shuffled[pi + 1]])
    pi += 2
  }
  for (let i = 0; i < byeCount; i++) {
    pairs.push([shuffled[pi], BYE])
    pi++
  }

  const matches = []
  for (let i = 0; i < pairs.length; i++) {
    const [p1, p2] = pairs[i]
    const isBye = p2.playerId === 'BYE'

    const m = {
      matchId: `match_r1_p${i + 1}_${Date.now()}_${i}`,
      round: 1,
      position: i + 1,
      player1: { id: p1.playerId, name: p1.playerName, registrationId: p1.registrationId },
      player2: isBye ? { id: 'BYE', name: 'BYE' } : { id: p2.playerId, name: p2.playerName, registrationId: p2.registrationId },
      bye: isBye,
      status: isBye ? 'walkover' : 'pending',
      resultStatus: isBye ? 'confirmed' : 'pending',
      winner: isBye ? { id: p1.playerId, name: p1.playerName } : null,
      courtId: null,
      queueOrder: null
    }
    matches.push(m)
  }
  return matches
}

function generateRegularR1(registrations) {
  const shuffled = shuffle(registrations)
  const pairCount = Math.floor(shuffled.length / 2)
  const matches = []
  for (let i = 0; i < pairCount; i++) {
    const p1 = shuffled[i * 2]
    const p2 = shuffled[i * 2 + 1]
    matches.push({
      matchId: `match_r1_p${i + 1}_${Date.now()}_${i}`,
      round: 1,
      position: i + 1,
      player1: { id: p1.playerId, name: p1.playerName, registrationId: p1.registrationId },
      player2: { id: p2.playerId, name: p2.playerName, registrationId: p2.registrationId },
      bye: false,
      status: 'pending',
      resultStatus: 'pending',
      winner: null,
      courtId: null,
      queueOrder: null,
      matchKind: 'regularRound'
    })
  }
  return matches
}

function advanceWinner({ round, position, winner, isFinal }) {
  if (isFinal) return null
  const nextPosition = Math.ceil(position / 2)
  const slot = position % 2 === 1 ? 'player1' : 'player2'
  return { nextRound: round + 1, nextPosition, slot, winner }
}

module.exports = { generateFirstRound, advanceWinner, finalRoundOf, INSUFFICIENT_PLAYERS }
