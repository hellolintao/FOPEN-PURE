# Tournament Detail Cold-Start Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore member identity before tournament-detail permission derivation, keep guest fallback safe, deploy the current tournament identity cloud contract, and upload mini-program version 2.3.4.

**Architecture:** `App.onLaunch()` owns a single `identityReady` Promise. Tournament detail awaits that Promise before parallel data reads, while failure falls back to public viewing. Compatibility fixes align `admin/isAdmin` and `openid/openId`; deployment packages only the two tournament identity cloud functions plus shared code.

**Tech Stack:** WeChat Mini Program JavaScript, WeChat Cloud Functions, Jest 29, WeChat DevTools CLI.

## Global Constraints

- Cold-start participant share entry must show `share` and `enterScore` after identity restoration.
- Cold-start guest or failed identity lookup must remain public-only and must never receive participant/admin actions.
- Use one identity restoration Promise per cold start; do not add duplicate `members.get` calls.
- Preserve the existing public identity deletion boundary: missing member records remain anonymous.
- Deploy only `tournament-brackets` and `tournament-registrations`; their packages include `_shared` automatically.
- Upload mini-program version `2.3.4` from the isolated worktree and exclude unrelated dirty files from the primary checkout.

---

### Task 1: Restore cold-start identity before tournament permissions

**Files:**
- Modify: `miniprogram/__tests__/app.test.js`
- Modify: `miniprogram/app.js`
- Modify: `miniprogram/pages/tournament-detail/__tests__/index.test.js`
- Modify: `miniprogram/pages/tournament-detail/index.js`

**Interfaces:**
- Consumes: `app.refreshIdentity(): Promise<Member|null>` and `app.identityReady`.
- Produces: `tournament-detail.refresh()` waits for the startup identity Promise before reading tournament registrations.

- [ ] **Step 1: Write failing app startup tests**

Add assertions that `onLaunch()` assigns the Promise returned by `refreshIdentity()` to `app.identityReady`, and that `refreshIdentity()` treats `{ isAdmin: true }` as an administrator.

- [ ] **Step 2: Run app tests and verify RED**

Run: `npm test -- --runInBand __tests__/app.test.js`

Expected: FAIL because startup currently does not create `identityReady` and legacy `isAdmin` is ignored.

- [ ] **Step 3: Write failing tournament-detail adversarial tests**

Replace the obsolete “does not refresh identity” test with cases for:

```js
test('cold-start participant share entry restores identity before deriving footer actions', async () => {
  // refreshIdentity sets currentMember m1; registration list contains m1.
  // Expect a single identity request and footer keys ['share', 'enterScore'].
})

test('failed cold-start identity restoration keeps the viewer public-only', async () => {
  // refreshIdentity rejects or returns null.
  // Expect refresh to complete and footer keys ['share'].
})
```

- [ ] **Step 4: Run tournament-detail tests and verify RED**

Run: `npm test -- --runInBand pages/tournament-detail/__tests__/index.test.js`

Expected: participant test FAILS with footer `['share']`; failure fallback must not hang.

- [ ] **Step 5: Implement the minimal startup and page sequencing**

In `app.js`, assign `this.identityReady = this.refreshIdentity()` after cloud initialization and derive admin from both fields. In tournament detail, make `ensureIdentity()` reuse or create `app.identityReady`, then call it before the existing `Promise.all`.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
cd miniprogram
npm test -- --runInBand __tests__/app.test.js pages/tournament-detail/__tests__/index.test.js
```

Expected: both suites pass with zero failures.

- [ ] **Step 7: Commit Task 1**

```bash
git add miniprogram/app.js miniprogram/__tests__/app.test.js \
  miniprogram/pages/tournament-detail/index.js \
  miniprogram/pages/tournament-detail/__tests__/index.test.js
git commit -m "fix(tournament): restore cold-start participant identity"
```

### Task 2: Align legacy member lookup and adversarial privacy checks

**Files:**
- Modify: `cloudfunctions/members/__tests__/index.test.js`
- Modify: `cloudfunctions/members/index.js`
- Modify: `scripts/privacy-adversarial-scan.js`
- Modify: `scripts/__tests__/privacy-adversarial-scan.test.js` if the scanner has direct unit coverage.

**Interfaces:**
- Consumes: WeChat context `OPENID` and member rows containing either `openid` or `openId`.
- Produces: `members.get` resolves either schema spelling; privacy scan accepts the explicitly restored startup identity contract while retaining public database-read checks.

- [ ] **Step 1: Write a failing legacy `openId` member test**

Add a `members.get` case whose mocked row contains `openId` and assert the query accepts both spellings and returns that member.

- [ ] **Step 2: Run the members test and verify RED**

Run: `npm test -- --runInBand __tests__/index.test.js`

Expected: FAIL because `action=get` currently queries only `{ openid }`.

- [ ] **Step 3: Implement the minimal compatible query**

Use the existing `db.command.or([{ openid }, { openId: openid }])` pattern in the `action=get` branch; do not change any mutation path.

- [ ] **Step 4: Update the adversarial scanner contract**

Remove only the rule that forbids `App.onLaunch()` and tournament detail from restoring identity. Keep checks against frontend direct member/tournament database reads, OpenID comparisons, and unguarded profile writes.

- [ ] **Step 5: Run focused tests and privacy audit**

Run:

```bash
cd cloudfunctions/members && npm test -- --runInBand __tests__/index.test.js
cd ../../scripts && npm test -- --runInBand && npm run audit:privacy
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit Task 2**

```bash
git add cloudfunctions/members/index.js cloudfunctions/members/__tests__/index.test.js \
  scripts/privacy-adversarial-scan.js scripts/__tests__
git commit -m "fix(identity): support legacy member fields"
```

### Task 3: Verify role isolation and cloud identity contract

**Files:**
- Modify only if a missing regression is proven: `cloudfunctions/tournament-brackets/__tests__/public-identity.test.js`
- Modify only if a missing regression is proven: `cloudfunctions/tournament-registrations/__tests__/self-service.test.js`

**Interfaces:**
- Consumes: current `_shared/public-profile.js` behavior.
- Produces: evidence that existing members keep tournament nicknames while deleted/missing members remain anonymous.

- [ ] **Step 1: Add or confirm adversarial identity cases**

Cover both:

```js
toPublicIdentity({ name: '真实昵称', publicProfileConsent: false }, { index: 1 })
// name remains 真实昵称

toPublicIdentity(undefined, { index: 1 })
// name remains 选手02
```

- [ ] **Step 2: Run cloud identity suites**

Run:

```bash
cd cloudfunctions/_shared && npm test -- --runInBand
cd ../tournament-brackets && npm test -- --runInBand
cd ../tournament-registrations && npm test -- --runInBand
```

Expected: all suites pass; add the smallest missing regression before any production change.

- [ ] **Step 3: Commit only if tests changed**

```bash
git add cloudfunctions/tournament-brackets/__tests__ cloudfunctions/tournament-registrations/__tests__
git commit -m "test(tournament): harden public identity boundaries"
```

### Task 4: Full verification, deployment, and upload

**Files:**
- Create: `appeal-evidence/deploy-record-20260713-tournament-identity.txt`
- Create: `appeal-evidence/upload-record-20260713-v2.3.4.txt`
- Create: `appeal-evidence/upload-info-20260713-v2.3.4.json`

**Interfaces:**
- Consumes: verified worktree source and WeChat DevTools CLI.
- Produces: deployed cloud functions and uploaded mini-program version 2.3.4 with audit records.

- [ ] **Step 1: Run the complete local verification matrix**

```bash
cd miniprogram && npm test -- --runInBand
cd ../cloudfunctions/members && npm test -- --runInBand
cd ../cloudfunctions/_shared && npm test -- --runInBand
cd ../cloudfunctions/tournament-brackets && npm test -- --runInBand
cd ../cloudfunctions/tournament-registrations && npm test -- --runInBand
cd ../../scripts && npm test -- --runInBand && npm run audit:privacy
git diff --check
```

- [ ] **Step 2: Deploy tournament identity cloud functions**

```bash
node scripts/deploy-cloud-functions.js \
  --env cloud1-0gthnke69a09f52a \
  tournament-brackets tournament-registrations
```

Require CLI exit 0 and success=true for both functions before continuing.

- [ ] **Step 3: Upload mini-program 2.3.4**

Use `/Applications/wechatwebdevtools.app/Contents/MacOS/cli upload` with project path equal to this isolated worktree, version `2.3.4`, and description `修复分享冷启动参赛者身份与赛事昵称显示`.

- [ ] **Step 4: Record exact deployment and upload output**

Write function names, environment, version, package size, timestamps, and CLI success output to the three evidence files.

- [ ] **Step 5: Final adversarial review**

Review the complete branch diff for privilege escalation, duplicate identity requests, privacy-scan weakening beyond the requested rule, accidental inclusion of unrelated files, and mismatch between deployed source and verified source.
