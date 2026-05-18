# Tournament Detail Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Events tab open the same tournament detail page used by management, with admin/participant/viewer permissions.

**Architecture:** Keep `pages/tournament-detail` as the primary detail surface. Add permission decoration in `pages/match` for list labels and in `pages/tournament-detail` for score entry permission; keep `pages/tournament-view` untouched.

**Tech Stack:** WeChat Mini Program WXML/WXSS/JS, Jest unit tests, WeChat DevTools CLI upload.

---

### Task 1: Events Tab Routing And Labels

**Files:**
- Create: `miniprogram/pages/match/__tests__/index.test.js`
- Modify: `miniprogram/pages/match/index.js`
- Modify: `miniprogram/pages/match/index.wxml`
- Modify: `miniprogram/pages/match/index.wxss`

- [ ] **Step 1: Write failing tests**

Cover these behaviors:

```js
test('opens unified tournament detail page from events list', () => {
  ctx.onItemTap({ currentTarget: { dataset: { id: 't1' } } })
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/tournament-detail/index?id=t1' })
})

test('decorates admin events as editable', async () => {
  app.globalData.isAdmin = true
  await ctx.loadTournaments()
  expect(ctx.data.tournaments[0].__permissionLabel).toBe('可编辑')
})

test('decorates participant events as scoreable', async () => {
  app.globalData.currentMember = { _id: 'm1' }
  await ctx.loadTournaments()
  expect(ctx.data.tournaments[0].__permissionLabel).toBe('可录分')
})

test('decorates non-participant events as view only', async () => {
  app.globalData.currentMember = { _id: 'm2' }
  await ctx.loadTournaments()
  expect(ctx.data.tournaments[0].__permissionLabel).toBe('仅查看')
})
```

- [ ] **Step 2: Run failing tests**

Run: `cd miniprogram && npm test -- pages/match/__tests__/index.test.js --runInBand`

Expected: fail because the current code routes to `tournament-view` and does not decorate permission labels.

- [ ] **Step 3: Implement routing and permission decoration**

Add identity sync before loading tournaments, query registrations for the current member when needed, and decorate each tournament with `__permissionLabel` and `__permissionKind`.

- [ ] **Step 4: Update Events list UI**

Render the label inside each card header:

```xml
<text class="match-card-permission permission-{{item.__permissionKind}}">{{item.__permissionLabel}}</text>
```

- [ ] **Step 5: Verify**

Run: `cd miniprogram && npm test -- pages/match/__tests__/index.test.js --runInBand`

Expected: all tests in the file pass.

### Task 2: Tournament Detail Score Permission

**Files:**
- Create: `miniprogram/pages/tournament-detail/__tests__/index.test.js`
- Modify: `miniprogram/pages/tournament-detail/index.js`
- Modify: `miniprogram/pages/tournament-detail/index.wxml`
- Modify: `miniprogram/pages/tournament-detail/index.wxss`

- [ ] **Step 1: Write failing tests**

Cover these behaviors:

```js
test('participant can enter score page', async () => {
  app.globalData.currentMember = { _id: 'm1' }
  await ctx.loadRegistrations()
  ctx.onEnterScore()
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/tournament-score/index?tournamentId=t1' })
})

test('viewer sees toast instead of entering score page', () => {
  ctx.setData({ tournamentId: 't1', isParticipant: false, isAdmin: false, canEnterScore: false })
  ctx.onEnterScore()
  expect(wx.showToast).toHaveBeenCalledWith({ title: '仅参赛者可录入', icon: 'none' })
  expect(wx.navigateTo).not.toHaveBeenCalled()
})

test('admin can enter score page', () => {
  ctx.setData({ tournamentId: 't1', isAdmin: true, canEnterScore: true })
  ctx.onEnterScore()
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/tournament-score/index?tournamentId=t1' })
})
```

- [ ] **Step 2: Run failing tests**

Run: `cd miniprogram && npm test -- pages/tournament-detail/__tests__/index.test.js --runInBand`

Expected: fail because `canEnterScore` does not exist and `onEnterScore` always navigates.

- [ ] **Step 3: Implement permission state**

Add `isParticipant` and `canEnterScore` to page data. After registrations load, set participant status by checking `playerId` and `partnerId` against `app.globalData.currentMember._id`. Compute `canEnterScore` from admin or participant state.

- [ ] **Step 4: Implement guarded score entry**

Update `onEnterScore()` so non-participants get `wx.showToast({ title: '仅参赛者可录入', icon: 'none' })`.

- [ ] **Step 5: Verify**

Run: `cd miniprogram && npm test -- pages/tournament-detail/__tests__/index.test.js --runInBand`

Expected: all tests in the file pass.

### Task 3: Full Verification And Release

**Files:**
- No new code files unless tests reveal a regression.

- [ ] **Step 1: Run all tests**

Run: `cd miniprogram && npm test -- --runInBand`

Expected: all Jest suites pass.

- [ ] **Step 2: Upload mini program**

Run WeChat DevTools CLI upload from repo root:

```bash
/Applications/wechatwebdevtools.app/Contents/MacOS/cli upload \
  --project /Users/liaoxiaole/FOPEN-PURE \
  --version 2026.05.19.3 \
  --desc "统一赛事详情入口并区分录分权限" \
  --qr-format image \
  --qr-output /tmp/fopen-miniprogram-upload/upload-20260519-3-qr.png \
  --info-output /tmp/fopen-miniprogram-upload/upload-20260519-3-info.json \
  --lang zh
```

Expected: CLI prints `✔ upload`.

- [ ] **Step 3: Commit and push**

Run:

```bash
git add docs/superpowers/plans/2026-05-19-tournament-detail-unification.md miniprogram/pages/match miniprogram/pages/tournament-detail
git commit -m "Unify tournament detail entry permissions"
git push origin main
```

Expected: `main -> main` push succeeds.

