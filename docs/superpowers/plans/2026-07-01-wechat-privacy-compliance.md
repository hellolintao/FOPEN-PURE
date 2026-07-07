# WeChat Privacy Compliance Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the mini-program data flow into alignment with WeChat section 15 by closing deletion, authorization, sanitization, consent, and verification gaps.

**Architecture:** Treat cloud functions as the only privacy boundary for user-related data. Public endpoints must return sanitized identity only, self-service deletion must cascade through all user-related collections, and write operations must be server-authorized rather than UI-hidden.

**Tech Stack:** WeChat Mini Program JavaScript, WeChat Cloud Functions, `wx-server-sdk`, Jest tests.

## Global Constraints

- Do not revert existing uncommitted user or prior-agent changes.
- Do not expose `openid`, `openId`, `unionid`, phone fields, admin flags, or raw public-consent fields to non-admin callers.
- Public identity is visible only when `publicProfileConsent === true`; otherwise return anonymous names and default avatar.
- Normal users may use public pages without granting profile-publication consent.
- Deletion must remove or irreversibly anonymize all data about the requesting user unless the app documents a lawful retention reason.
- All legacy mutation endpoints must be protected by server-side authorization.
- Frontend public pages must not read collections directly when the document may contain internal identifiers.
- Add or update tests before production changes where behavior can be tested.

---

### Task 1: Full Self-Service Deletion

**Files:**
- Modify: `cloudfunctions/members/index.js`
- Modify/Test: `cloudfunctions/members/__tests__/index.test.js`
- Modify: `miniprogram/pages/setting/index.js`
- Modify: `miniprogram/pages/privacy-policy/index.wxml`

**Interfaces:**
- Consumes: current `members.deleteSelf` action.
- Produces: `deleteSelf` that removes the caller member row and removes/anonymizes related registrations, brackets, match results, point/rank/weekly derived records, local cache signals, and cloud avatar file when applicable.

- [ ] Add failing Jest tests for `deleteSelf` proving it touches `members`, `tournament_registrations`, `match_results`, `tournament_brackets`, `tournament_points`, `rank_cache`, `rank_snapshots`, and `weekly_stars`.
- [ ] Run `cd cloudfunctions/members && npm test -- --runTestsByPath __tests__/index.test.js` and verify the new tests fail for incomplete deletion.
- [ ] Implement deletion helper functions in `cloudfunctions/members/index.js` using batch-safe queries and updates/removes.
- [ ] Update setting-page cache clearing to clear all privacy-related prefixes, not only `rank:`.
- [ ] Update privacy-policy deletion copy so it no longer claims only member profile deletion.
- [ ] Re-run the members tests and miniprogram setting tests.

### Task 2: Server-Side Authorization For Legacy Mutations

**Files:**
- Modify/Test: `cloudfunctions/tournaments/index.js`
- Modify/Test: `cloudfunctions/tournament-registrations/index.js`
- Modify/Test: `cloudfunctions/tournament-brackets/index.js`
- Modify/Test: `cloudfunctions/match-results/index.js`
- Modify: `cloudfunctions/free-plays/index.js`
- Modify: `cloudfunctions/courts/index.js`
- Modify: `cloudfunctions/seasons/index.js`

**Interfaces:**
- Consumes: existing `requireAdmin` / caller-member patterns in each function.
- Produces: all legacy `add`, `update`, `delete`, status, seed, score, bracket, court, free-play, and season mutations return `FORBIDDEN` or equivalent for non-admin callers.

- [ ] Add failing tests for representative legacy mutation actions in tournaments, registrations, brackets, and match results.
- [ ] Run each targeted test file and verify failure before implementation.
- [ ] Add server-side admin gates to every legacy mutation listed in the audit.
- [ ] Keep self-service registration/withdraw and participant score submission paths working.
- [ ] Re-run targeted cloud-function tests.

### Task 3: Public Read Sanitization And Direct DB Removal

**Files:**
- Modify/Test: `cloudfunctions/tournaments/index.js`
- Modify/Test: `cloudfunctions/match-results/index.js`
- Modify/Test: `cloudfunctions/match-results/lib/handlers/query.js`
- Modify: `miniprogram/pages/match/index.js`
- Modify: `miniprogram/pages/tournament-detail/index.js`
- Modify: `miniprogram/pages/tournament-add-player/index.js`
- Modify: `miniprogram/pages/tournament-add-players-doubles/index.js`
- Modify: `miniprogram/pages/round-settlement/index.js`

**Interfaces:**
- Consumes: existing public identity helper and existing cloud functions.
- Produces: public reads return sanitized documents and frontend routes use cloud-function reads instead of direct collection reads.

- [ ] Add failing tests proving non-admin `tournaments.get/list` omit `createdByOpenid`.
- [ ] Add failing tests proving legacy `match-results.list/getByTournament/getByPlayer` return sanitized public identity for non-admin callers.
- [ ] Replace frontend direct `wx.cloud.database().collection('tournaments')` reads with `tournaments` cloud-function calls.
- [ ] Re-run tests and scan `miniprogram` for remaining direct public collection reads.

### Task 4: Consent Model And Early Collection

**Files:**
- Modify/Test: `miniprogram/app.js`
- Modify/Test: `miniprogram/pages/edit-profile/index.js`
- Modify: `miniprogram/pages/edit-profile/index.wxml`
- Modify: `miniprogram/pages/privacy-policy/index.wxml`
- Modify: `miniprogram/pages/user-agreement/index.wxml`

**Interfaces:**
- Consumes: existing official privacy authorization helper.
- Produces: member registration no longer forces public real-identity display, and app launch does not eagerly fetch member data before a member feature needs it.

- [ ] Add failing tests that registration can create/claim without automatically setting `publicProfileConsent: true`.
- [ ] Add failing tests or static assertions that app launch initializes cloud without immediately calling `members.get`.
- [ ] Implement separate public-profile consent control or default false publication behavior.
- [ ] Update copy to distinguish required service processing from optional real-identity public display.
- [ ] Re-run edit-profile/app tests.

### Task 5: First-Principles Adversarial Verification

**Files:**
- Modify/Create: `appeal-evidence/appeal-materials-20260701-v2.1.md`
- Modify/Create: `appeal-evidence/privacy-adversarial-audit-20260701.md`

**Interfaces:**
- Consumes: final code and test results.
- Produces: an audit checklist mapped to WeChat 15.1, 15.2, 15.3, 15.4 plus evidence gaps for backend privacy-guide review.

- [ ] Run targeted tests for changed cloud functions and miniprogram pages.
- [ ] Run static scans for direct database reads, raw identifier fields, location APIs, and legacy mutation actions.
- [ ] Review the code against each WeChat section 15 subsection.
- [ ] If any P0/P1 verification fails, add a failing test and loop back to the responsible task.
- [ ] Write final appeal/evidence notes only after verification passes.
