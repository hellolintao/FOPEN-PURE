const members = [
  {
    _id: 'mock_m_001',
    name: '林一舟',
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&h=120&fit=crop',
    playStyle: '右手底线型',
    playStyleNote: '正手上旋稳定，喜欢用多拍相持打开角度。',
    admin: true
  },
  {
    _id: 'mock_m_002',
    name: '陈嘉宁',
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&h=120&fit=crop',
    playStyle: '全场型',
    playStyleNote: '发球落点变化多，网前截击处理果断。'
  },
  {
    _id: 'mock_m_003',
    name: '周以默',
    avatarUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=120&h=120&fit=crop',
    playStyle: '左手进攻型',
    playStyleNote: '反拍斜线质量高，关键分敢于抢攻。'
  },
  {
    _id: 'mock_m_004',
    name: '王梓晴',
    avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120&h=120&fit=crop',
    playStyle: '反击型',
    playStyleNote: '移动覆盖好，擅长把防守球转为深区压制。'
  },
  {
    _id: 'mock_m_005',
    name: '赵南风',
    avatarUrl: 'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?w=120&h=120&fit=crop',
    playStyle: '发上型',
    playStyleNote: '一发成功率高，喜欢快速结束回合。'
  },
  {
    _id: 'mock_m_006',
    name: '许知远',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop',
    playStyle: '稳定相持型',
    playStyleNote: '失误少，长回合质量稳定。'
  },
  {
    _id: 'mock_m_007',
    name: '沈鹿鸣',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&h=120&fit=crop',
    playStyle: '双打网前型',
    playStyleNote: '抢网积极，补位意识强。'
  },
  {
    _id: 'mock_m_008',
    name: '韩青禾',
    avatarUrl: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=120&h=120&fit=crop',
    playStyle: '节奏变化型',
    playStyleNote: '切削和放小球使用频繁，节奏感强。'
  },
  {
    _id: 'mock_m_009',
    name: '刘星河',
    avatarUrl: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=120&h=120&fit=crop',
    playStyle: '进攻底线型',
    playStyleNote: '接发抢二拍能力突出。'
  },
  {
    _id: 'mock_m_010',
    name: '何予安',
    avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&h=120&fit=crop',
    playStyle: '耐心防守型',
    playStyleNote: '落点深，擅长拖入多拍。'
  },
  {
    _id: 'mock_m_011',
    name: '高明澈',
    avatarUrl: 'https://images.unsplash.com/photo-1504257432389-52343af06ae3?w=120&h=120&fit=crop',
    playStyle: '强力发球型',
    playStyleNote: '一发速度快，二发旋转重。'
  },
  {
    _id: 'mock_m_012',
    name: '唐若溪',
    avatarUrl: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=120&h=120&fit=crop',
    playStyle: '双反底线型',
    playStyleNote: '反拍直线是主要得分手段。'
  }
]

const singlesRanks = [
  ['mock_m_002', 286, 9, 2],
  ['mock_m_001', 268, 8, 3],
  ['mock_m_003', 245, 7, 3],
  ['mock_m_004', 232, 7, 4],
  ['mock_m_005', 218, 6, 4],
  ['mock_m_006', 207, 6, 5],
  ['mock_m_009', 194, 5, 5],
  ['mock_m_011', 181, 5, 6],
  ['mock_m_008', 176, 4, 5],
  ['mock_m_010', 168, 4, 6],
  ['mock_m_012', 151, 3, 6],
  ['mock_m_007', 139, 3, 7]
]

const doublesRanks = [
  ['mock_m_007', 304, 10, 1],
  ['mock_m_004', 291, 9, 2],
  ['mock_m_001', 276, 8, 2],
  ['mock_m_012', 264, 8, 3],
  ['mock_m_002', 240, 7, 3],
  ['mock_m_008', 226, 6, 4],
  ['mock_m_005', 211, 6, 5],
  ['mock_m_003', 198, 5, 5],
  ['mock_m_006', 184, 5, 6],
  ['mock_m_009', 173, 4, 6],
  ['mock_m_010', 160, 4, 7],
  ['mock_m_011', 148, 3, 7]
]

const recentMatches = [
  { _id: 'mock_match_001', round: 1, resultStatus: 'confirmed', date: '2026-05-03', score: '4-2 4-1' },
  { _id: 'mock_match_002', round: 2, resultStatus: 'confirmed', date: '2026-05-04', score: '3-4 4-1 10-6' },
  { _id: 'mock_match_003', round: 3, resultStatus: 'confirmed', date: '2026-05-10', score: '4-0 4-2' },
  { _id: 'mock_match_004', round: 4, resultStatus: 'confirmed', date: '2026-05-12', score: '2-4 4-3 10-8' }
]

module.exports = {
  members,
  singlesRanks,
  doublesRanks,
  recentMatches
}
