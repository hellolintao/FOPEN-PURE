# Tournament Registration Login Return Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tournament registration visible to guests while routing guest clicks through login or registration and returning to the tournament registration section without auto-registering.

**Architecture:** Keep public tournament detail browsing passive. Add a small login-confirmation gate inside `onRegisterSelf`, reuse the existing `edit-profile` tournament-register return context, and keep the actual `selfRegister` cloud call limited to already complete member identities.

**Tech Stack:** WeChat Mini Program page JS/WXML, Jest tests under `miniprogram/pages/*/__tests__`.

## Global Constraints

- Do not trigger identity refresh while browsing public tournament detail.
- Do not auto-submit tournament registration after login or registration.
- Do not change backend registration authorization.
- Keep changes scoped to `tournament-detail` and existing `edit-profile` return behavior.

---

### Task 1: Guest Registration Login Gate

**Files:**
- Modify: `miniprogram/pages/tournament-detail/index.js`
- Test: `miniprogram/pages/tournament-detail/__tests__/index.test.js`

**Interfaces:**
- Consumes: existing `onRegisterSelf()`, `ensureIdentity({ requirePrivacy: true })`, `openRegistrationIdentityEditor()`.
- Produces: `confirmRegistrationLogin()` returning `Promise<boolean>`; `onRegisterSelf()` returns early for guest login/registration completion without calling `selfRegister`.

- [ ] **Step 1: Write failing tests**

Add tests proving guest cancel does nothing, guest login success returns to the registration section without auto-registration, and guest missing member opens the registration editor without auto-registration.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --runInBand pages/tournament-detail/__tests__/index.test.js`

Expected: FAIL because no login modal exists and guest login currently falls through to profile navigation without the requested explicit modal/return behavior.

- [ ] **Step 3: Implement minimal page logic**

Add `confirmRegistrationLogin()` to wrap `wx.showModal`. In `onRegisterSelf()`, when `app.globalData.currentMember` is missing, show the modal first. If canceled, return. If confirmed and `ensureIdentity()` finds a complete member, set `entry=register`, refresh, and return without calling `selfRegister`. If confirmed and no complete member exists, open the existing registration editor and return.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- --runInBand pages/tournament-detail/__tests__/index.test.js`

Expected: PASS.

### Task 2: Return Flow Regression Check

**Files:**
- Test: `miniprogram/pages/edit-profile/__tests__/index.test.js`
- Verify: `miniprogram/pages/edit-profile/index.js`

**Interfaces:**
- Consumes: existing `from=tournament-register&tournamentId=<id>` query and `registrationIdentityReady` event channel.
- Produces: no behavior change unless a regression test exposes a gap.

- [ ] **Step 1: Confirm existing tests cover event channel and redirect fallback**

Run: `npm test -- --runInBand pages/edit-profile/__tests__/index.test.js`

Expected: PASS with tests covering `registrationIdentityReady`, `wx.navigateBack({ delta: 1 })`, and redirect fallback to `/pages/tournament-detail/index?id=<id>&entry=register`.

- [ ] **Step 2: Add a regression assertion only if coverage is missing**

If coverage does not prove non-auto-registration return context, add the smallest assertion to the existing tournament-register tests.

- [ ] **Step 3: Run combined focused tests**

Run: `npm test -- --runInBand pages/tournament-detail/__tests__/index.test.js pages/edit-profile/__tests__/index.test.js`

Expected: PASS.

### Task 3: Final Verification

**Files:**
- Verify: changed files only

**Interfaces:**
- Consumes: Task 1 and Task 2 passing focused tests.
- Produces: verified implementation ready for manual WeChat DevTools smoke check.

- [ ] **Step 1: Inspect diff**

Run: `git diff -- miniprogram/pages/tournament-detail/index.js miniprogram/pages/tournament-detail/__tests__/index.test.js miniprogram/pages/edit-profile/index.js miniprogram/pages/edit-profile/__tests__/index.test.js docs/superpowers/specs/2026-07-08-tournament-registration-login-return-design.md docs/superpowers/plans/2026-07-08-tournament-registration-login-return.md`

Expected: diff only contains the scoped login return behavior and docs.

- [ ] **Step 2: Run focused verification**

Run: `npm test -- --runInBand pages/tournament-detail/__tests__/index.test.js pages/edit-profile/__tests__/index.test.js`

Expected: PASS.
