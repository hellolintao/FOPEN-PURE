const {
  toPublicIdentity,
  toRankingIdentity
} = require('../public-profile')

test('toPublicIdentity keeps avatars outside the ranking page even without public display consent', () => {
  expect(toPublicIdentity({
    _id: 'm1',
    name: '张三',
    avatarUrl: 'cloud://avatar',
    publicProfileConsent: false
  })).toEqual({
    name: '张三',
    avatarUrl: 'cloud://avatar',
    publicProfileVisible: false
  })
})

test('toRankingIdentity hides avatars while preserving the public display name', () => {
  expect(toRankingIdentity({
    _id: 'm1',
    name: '张三',
    avatarUrl: 'cloud://avatar',
    publicProfileConsent: false
  })).toEqual({
    name: '张三',
    avatarUrl: '',
    publicProfileVisible: false
  })
})
