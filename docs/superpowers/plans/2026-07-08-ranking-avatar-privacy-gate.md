# Ranking Avatar Privacy Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show ranking avatars only when the current visitor is registered and has `publicProfileConsent === true`, while preserving the current no-avatar ranking for unregistered or unconsented visitors.

**Architecture:** Keep the existing ranking data flow. Cloud functions expose avatars only for ranked members who have opted into public profile display; the mini-program rank page then applies a second visitor gate before passing `avatarUrl` into the reusable `rank-row` component.

**Tech Stack:** WeChat mini-program WXML/WXSS/JavaScript, Jest 29.7.0, `wx-server-sdk` cloud functions.

## Global Constraints

- Avatar visibility is controlled by the current visitor: `currentMember && currentMember._id && currentMember.publicProfileConsent === true`.
- Unlogged, unregistered, or unconsented visitors keep the current no-avatar ranking view.
- Scope is limited to ranking display, `rank-row`, and the shared ranking identity function.
- Do not change nickname, points, win rate, trend, ranking order, WeChat privacy authorization flow, or cloud database schemas.
- Do not restore weekly-star avatar display in this change.
- Write failing tests before production changes.

---

## File Structure

- Modify `cloudfunctions/_shared/public-profile.js`: make `toRankingIdentity(member, options)` keep an avatar only when the ranked member has `publicProfileConsent === true`.
- Modify `cloudfunctions/_shared/__tests__/public-profile.test.js`: pin ranking identity avatar behavior for public and private members.
- Modify `cloudfunctions/points-engine/__tests__/index.test.js`: pin live and cached `rankList` avatar behavior through the real `points-engine` path.
- Modify `miniprogram/pages/rank/index.js`: add `canViewRankAvatars`, derive it from `currentMember`, and apply it in `_sanitizeRankRow`.
- Modify `miniprogram/pages/rank/index.wxml`: pass `avatar-url="{{item.avatarUrl}}"` to `rank-row`.
- Modify `miniprogram/pages/rank/__tests__/index.test.js`: cover visitor-gated sanitization, cloud rows, cached rows, and WXML binding.
- Modify `miniprogram/components/rank-row/index.js`: add an optional `avatarUrl` property.
- Modify `miniprogram/components/rank-row/index.wxml`: render an image only when `avatarUrl` exists.
- Modify `miniprogram/components/rank-row/index.wxss`: add compact avatar styles inside the existing player cell without changing the no-avatar row layout.
- Modify `miniprogram/components/rank-row/__tests__/index.test.js`: pin the property and conditional WXML contract.

## Task 1: Cloud Ranking Identity

**Files:**
- Modify: `cloudfunctions/_shared/public-profile.js`
- Modify: `cloudfunctions/_shared/__tests__/public-profile.test.js`
- Modify: `cloudfunctions/points-engine/__tests__/index.test.js`

**Interfaces:**
- Consumes: `hasPublicProfileConsent(member): boolean`
- Produces: `toRankingIdentity(member, options): { name: string, avatarUrl: string, publicProfileVisible: boolean }`

- [ ] **Step 1: Write the failing shared identity tests**

In `cloudfunctions/_shared/__tests__/public-profile.test.js`, replace the current ranking test with two explicit cases:

```javascript
test('toRankingIdentity keeps avatars for members with public display consent', () => {
  expect(toRankingIdentity({
    _id: 'm1',
    name: '张三',
    avatarUrl: 'cloud://avatar',
    publicProfileConsent: true
  })).toEqual({
    name: '张三',
    avatarUrl: 'cloud://avatar',
    publicProfileVisible: true
  })
})

test('toRankingIdentity hides avatars for members without public display consent', () => {
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
```

- [ ] **Step 2: Verify the shared identity test fails**

Run:

```bash
cd cloudfunctions/_shared && npm test -- __tests__/public-profile.test.js
```

Expected: FAIL on `toRankingIdentity keeps avatars for members with public display consent` because `avatarUrl` is currently `''`.

- [ ] **Step 3: Implement the minimal shared identity change**

In `cloudfunctions/_shared/public-profile.js`, change `toRankingIdentity` to:

```javascript
function toRankingIdentity(member, options = {}) {
  const identity = toPublicIdentity(member, options)
  const visible = hasPublicProfileConsent(member)
  return {
    ...identity,
    avatarUrl: visible && member && member.avatarUrl ? member.avatarUrl : ''
  }
}
```

- [ ] **Step 4: Verify shared identity tests pass**

Run:

```bash
cd cloudfunctions/_shared && npm test -- __tests__/public-profile.test.js
```

Expected: PASS.

- [ ] **Step 5: Write failing points-engine rankList tests**

In `cloudfunctions/points-engine/__tests__/index.test.js`, add this test inside `describe('rankList enhancements', ...)`:

```javascript
test('rankList returns avatars only for ranked members with public display consent', async () => {
  const cloud = require('wx-server-sdk')
  cloud.__rows.members.push(
    { _id: 'public-player', name: '公开选手', avatarUrl: 'public.png', publicProfileConsent: true },
    { _id: 'private-player', name: '私密选手', avatarUrl: 'private.png', publicProfileConsent: false }
  )
  cloud.__rows.baseline_standings.push(
    {
      _id: 'baseline_public',
      seasonId: 'season_2026',
      type: 'singles',
      memberId: 'public-player',
      totalPoints: 100,
      wins: 1,
      losses: 0,
      createTime: '2026-07-01'
    },
    {
      _id: 'baseline_private',
      seasonId: 'season_2026',
      type: 'singles',
      memberId: 'private-player',
      totalPoints: 90,
      wins: 0,
      losses: 1,
      createTime: '2026-07-01'
    }
  )

  const { main } = require('../index')
  const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' })

  expect(res.data.rankList.map(row => ({
    _id: row._id,
    avatarUrl: row.avatarUrl,
    publicProfileVisible: row.publicProfileVisible
  }))).toEqual([
    { _id: 'public-player', avatarUrl: 'public.png', publicProfileVisible: true },
    { _id: 'private-player', avatarUrl: '', publicProfileVisible: false }
  ])
})
```

Also update existing `rankList refreshes member profile fields on cached rows without recomputing points` expected output so the public member expects `avatarUrl: 'fresh.png'`.

- [ ] **Step 6: Verify the points-engine tests fail for the new expectation**

Run:

```bash
cd cloudfunctions/points-engine && npm test -- __tests__/index.test.js --runInBand
```

Expected before Step 3 is FAIL on public avatars; after Step 3 the new test should PASS, while older expectations that still assert `avatarUrl: ''` for public members may fail and must be updated to match the new contract.

- [ ] **Step 7: Update points-engine expectations to the new contract**

In `cloudfunctions/points-engine/__tests__/index.test.js`, keep `avatarUrl: ''` for members without `publicProfileConsent === true`. For members seeded with `publicProfileConsent: true` and a real `avatarUrl`, expect the real avatar string. Known public seeded cases include cached profile refresh rows such as:

```javascript
{
  _id: 'CACHED',
  name: '新头像用户',
  avatarUrl: 'fresh.png',
  publicProfileVisible: true,
  totalPoints: 10,
  winCount: 1,
  lossCount: 0,
  winRate: 1,
  trendDelta: null,
  trendState: 'no_history',
  trendLabel: '暂无历史'
}
```

- [ ] **Step 8: Verify cloud task passes**

Run:

```bash
cd cloudfunctions/_shared && npm test -- __tests__/public-profile.test.js
cd ../points-engine && npm test -- __tests__/index.test.js --runInBand
```

Expected: both commands PASS.

- [ ] **Step 9: Commit cloud task**

Run:

```bash
git add cloudfunctions/_shared/public-profile.js cloudfunctions/_shared/__tests__/public-profile.test.js cloudfunctions/points-engine/__tests__/index.test.js
git commit -m "fix: gate ranking avatars in cloud identity"
```

## Task 2: Rank Page Visitor Gate

**Files:**
- Modify: `miniprogram/pages/rank/index.js`
- Modify: `miniprogram/pages/rank/index.wxml`
- Modify: `miniprogram/pages/rank/__tests__/index.test.js`

**Interfaces:**
- Consumes: `currentMember` from `getApp().globalData.currentMember`
- Produces: `data.canViewRankAvatars: boolean`
- Produces: `_canViewRankAvatars(member): boolean`
- Produces: `_sanitizeRankRow(row): object` that keeps `avatarUrl` only when `this.data.canViewRankAvatars === true`

- [ ] **Step 1: Write failing rank page tests**

In `miniprogram/pages/rank/__tests__/index.test.js`, update `loadPage` to accept an optional member:

```javascript
function loadPage(currentMember = { _id: 'me' }) {
  jest.resetModules()
  let pageDef
  global.getApp = () => ({ globalData: { currentMember } })
  global.wx = {
    navigateTo: jest.fn(),
    showToast: jest.fn(),
    getStorageSync: jest.fn(),
    setStorageSync: jest.fn(),
    removeStorageSync: jest.fn(),
  }
  global.Page = (def) => { pageDef = def }
  jest.mock('../../../utils/cloud', () => ({ callFunction: jest.fn() }))
  require('../index')
  return pageDef
}
```

Add these tests:

```javascript
test('_canViewRankAvatars requires a registered current member with public display consent', () => {
  const def = loadPage()
  const ctx = makeCtx(def)

  expect(ctx._canViewRankAvatars(null)).toBe(false)
  expect(ctx._canViewRankAvatars({ _id: 'me', publicProfileConsent: false })).toBe(false)
  expect(ctx._canViewRankAvatars({ _id: 'me', publicProfileConsent: true })).toBe(true)
})

test('_sanitizeRankRow keeps avatar only when current visitor can view rank avatars', () => {
  const def = loadPage()
  const privateCtx = makeCtx(def, { canViewRankAvatars: false })
  const publicCtx = makeCtx(def, { canViewRankAvatars: true })

  expect(privateCtx._sanitizeRankRow({ _id: 'A', avatarUrl: 'a.png', winCount: 1, lossCount: 0 })).not.toHaveProperty('avatarUrl')
  expect(publicCtx._sanitizeRankRow({ _id: 'A', avatarUrl: 'a.png', winCount: 1, lossCount: 0 }).avatarUrl).toBe('a.png')
})

test('loadRank preserves cloud avatars for visitors who can view ranking avatars', async () => {
  const def = loadPage({ _id: 'me', publicProfileConsent: true })
  const { callFunction } = require('../../../utils/cloud')
  callFunction.mockResolvedValue({
    result: {
      data: {
        rankList: [
          { _id: 'A', name: '公开选手', avatarUrl: 'a.png', winCount: 1, lossCount: 0, winRate: 1 }
        ]
      }
    }
  })
  const ctx = makeCtx(def, { activeTab: 'singles', seasonYear: 2026, canViewRankAvatars: true })

  await ctx.loadRank()

  expect(ctx.data.rankList[0].avatarUrl).toBe('a.png')
})

test('loadRank strips cached avatars for visitors who cannot view ranking avatars', async () => {
  const def = loadPage(null)
  const { callFunction } = require('../../../utils/cloud')
  wx.getStorageSync.mockReturnValue({
    value: {
      rankList: [
        { _id: 'A', name: '缓存选手', avatarUrl: 'cached.png', winCount: 1, lossCount: 0, winRate: 1 }
      ]
    },
    updatedAt: 1000,
    expiresAt: Date.now() + 60 * 1000
  })
  callFunction.mockResolvedValue({
    result: {
      data: {
        rankList: [
          { _id: 'A', name: '云端选手', avatarUrl: 'fresh.png', winCount: 1, lossCount: 0, winRate: 1 }
        ]
      }
    }
  })
  const ctx = makeCtx(def, { activeTab: 'singles', seasonYear: 2026, canViewRankAvatars: false })

  await ctx.loadRank()

  expect(ctx.data.rankList[0]).not.toHaveProperty('avatarUrl')
})
```

Update the WXML contract test so it expects:

```javascript
expect(wxml).toContain('avatar-url="{{item.avatarUrl}}"')
expect(wxml).not.toContain('default-avatar.png')
```

- [ ] **Step 2: Verify rank page tests fail**

Run:

```bash
cd miniprogram && npm test -- pages/rank/__tests__/index.test.js --runInBand
```

Expected: FAIL because `_canViewRankAvatars` and the `avatar-url` binding do not exist, and `_sanitizeRankRow` always strips avatars.

- [ ] **Step 3: Implement visitor gate in rank page JavaScript**

In `miniprogram/pages/rank/index.js`, add `canViewRankAvatars` to `data`:

```javascript
canViewRankAvatars: false,
```

Change `onShow` to derive both `currentMember` and `canViewRankAvatars`:

```javascript
const currentMember = getApp().globalData.currentMember
this.setData({
  currentMember,
  canViewRankAvatars: this._canViewRankAvatars(currentMember)
})
```

Add the helper:

```javascript
_canViewRankAvatars(member) {
  return !!(member && member._id && member.publicProfileConsent === true)
},
```

Change `_sanitizeRankRow` to:

```javascript
_sanitizeRankRow(row) {
  const safeRow = { ...(row || {}) }
  if (!this.data.canViewRankAvatars) {
    delete safeRow.avatarUrl
  }
  return {
    ...safeRow,
    winRatePct: this._formatWinRatePct(row),
    trendState: safeRow.trendState || this._deriveTrendState(safeRow),
    trendLabel: safeRow.trendLabel || this._deriveTrendLabel(safeRow)
  }
},
```

- [ ] **Step 4: Add the WXML avatar binding**

In `miniprogram/pages/rank/index.wxml`, pass `avatarUrl` into `rank-row`:

```xml
avatar-url="{{item.avatarUrl}}"
```

Place it next to the existing `name="{{item.name}}"` binding.

- [ ] **Step 5: Verify rank page task passes**

Run:

```bash
cd miniprogram && npm test -- pages/rank/__tests__/index.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit rank page task**

Run:

```bash
git add miniprogram/pages/rank/index.js miniprogram/pages/rank/index.wxml miniprogram/pages/rank/__tests__/index.test.js
git commit -m "fix: gate ranking avatars by visitor consent"
```

## Task 3: Rank Row Avatar Rendering

**Files:**
- Modify: `miniprogram/components/rank-row/index.js`
- Modify: `miniprogram/components/rank-row/index.wxml`
- Modify: `miniprogram/components/rank-row/index.wxss`
- Modify: `miniprogram/components/rank-row/__tests__/index.test.js`

**Interfaces:**
- Consumes: `avatarUrl` string property from `miniprogram/pages/rank/index.wxml`
- Produces: conditional image markup that renders only when `avatarUrl` is truthy

- [ ] **Step 1: Write failing rank-row tests**

In `miniprogram/components/rank-row/__tests__/index.test.js`, add:

```javascript
test('rank-row exposes an optional avatarUrl property', () => {
  const def = loadComponent()
  expect(def.properties.avatarUrl).toBeTruthy()
})

test('rank-row template renders avatar image only when avatarUrl exists', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
  expect(wxml).toContain('wx:if="{{avatarUrl}}"')
  expect(wxml).toContain('src="{{avatarUrl}}"')
  expect(wxml).not.toContain('default-avatar.png')
})
```

- [ ] **Step 2: Verify rank-row tests fail**

Run:

```bash
cd miniprogram && npm test -- components/rank-row/__tests__/index.test.js --runInBand
```

Expected: FAIL because `avatarUrl` property and conditional image markup do not exist.

- [ ] **Step 3: Add the component property**

In `miniprogram/components/rank-row/index.js`, add:

```javascript
avatarUrl: String,
```

Place it after `name: String`.

- [ ] **Step 4: Add conditional avatar markup**

In `miniprogram/components/rank-row/index.wxml`, change the player cell to:

```xml
<view class="player-cell">
  <image wx:if="{{avatarUrl}}" class="player-avatar" src="{{avatarUrl}}" mode="aspectFill" />
  <text class="name">{{name}}</text>
</view>
```

- [ ] **Step 5: Add compact avatar styles**

In `miniprogram/components/rank-row/index.wxss`, add:

```css
.player-avatar {
  width: 44rpx;
  height: 44rpx;
  margin-right: 12rpx;
  border-radius: 50%;
  background: var(--color-surface);
  flex-shrink: 0;
}
```

Keep `.player-cell` as `display: flex; align-items: center; min-width: 0;` so no-avatar rows remain pure text.

- [ ] **Step 6: Verify rank-row task passes**

Run:

```bash
cd miniprogram && npm test -- components/rank-row/__tests__/index.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit rank-row task**

Run:

```bash
git add miniprogram/components/rank-row/index.js miniprogram/components/rank-row/index.wxml miniprogram/components/rank-row/index.wxss miniprogram/components/rank-row/__tests__/index.test.js
git commit -m "feat: render gated ranking avatars"
```

## Task 4: Final Verification

**Files:**
- No production file edits unless a previous task failed verification.

**Interfaces:**
- Consumes: all changes from Tasks 1-3.
- Produces: verified ranking avatar gate behavior.

- [ ] **Step 1: Run targeted cloud tests**

Run:

```bash
cd cloudfunctions/_shared && npm test -- __tests__/public-profile.test.js
cd ../points-engine && npm test -- __tests__/index.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run targeted mini-program tests**

Run:

```bash
cd miniprogram && npm test -- pages/rank/__tests__/index.test.js components/rank-row/__tests__/index.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 3: Run broader mini-program smoke tests for adjacent privacy pages**

Run:

```bash
cd miniprogram && npm test -- pages/mine/__tests__/index.test.js pages/setting/__tests__/index.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 4: Run a WeChat DevTools smoke check**

Open the mini-program in WeChat DevTools and check:

```text
1. 未登录状态进入排行榜，行内没有头像图像。
2. 登录注册且公开展示授权为 true 的账号进入排行榜，公开授权选手行显示头像。
3. 切换到未授权账号或撤回公开展示授权后返回排行榜，头像不显示。
4. 球员详情和赛事页头像策略没有因本次改动变化。
```

Expected: all four checks match the text above.

- [ ] **Step 5: Commit verification notes only if files changed**

If verification requires code or test adjustments, commit those changed files with:

```bash
git add cloudfunctions/_shared/public-profile.js cloudfunctions/_shared/__tests__/public-profile.test.js cloudfunctions/points-engine/__tests__/index.test.js miniprogram/pages/rank/index.js miniprogram/pages/rank/index.wxml miniprogram/pages/rank/__tests__/index.test.js miniprogram/components/rank-row/index.js miniprogram/components/rank-row/index.wxml miniprogram/components/rank-row/index.wxss miniprogram/components/rank-row/__tests__/index.test.js
git commit -m "test: verify ranking avatar privacy gate"
```

If no files changed, do not create an empty commit.
