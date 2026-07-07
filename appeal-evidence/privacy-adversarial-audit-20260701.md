# FuTennis Privacy Adversarial Audit - 2026-07-01

## Review Method

This audit maps the app against WeChat Mini Program Product Rule section 15, using first-principles checks:

- Can a user use public/non-member views without premature personal-data processing?
- Can a normal caller mutate or read data by bypassing UI controls?
- Does public data include direct or derived identifiers?
- Does refusal or non-consent fall back to anonymous service instead of blocking all service?
- Does deletion remove or irreversibly anonymize all user-related data, not only the member row?

## Section 15 Findings After Remediation

### 15.1 Data Collection And Storage

- 15.1.1: Profile collection still uses the official WeChat privacy authorization flow before avatar/profile writes. Public real-identity display is now a separate optional checkbox, not bundled into basic registration.
- 15.1.3.1: `App.onLaunch()` no longer calls `members.get`; member identity is fetched only by member/account flows.
- 15.1.3.2: Refusing optional public-display consent leaves public surfaces usable with anonymous identity.
- 15.1.4: `members.deleteSelf` now deletes the member row, removes derived point/rank/weekly rows, removes registrations, deletes cloud avatar files, and anonymizes historical match/bracket rows.

### 15.2 Data Use

- Public ranking, registrations, brackets, match rows, and tournament reads are sanitized for non-admin callers.
- Frontend no longer reads `tournaments` directly and no longer compares `openid`/`createdByOpenid` on public pages.
- Legacy `match-results` list/read actions now return sanitized public identity for non-admin callers.
- Static scan confirms no frontend direct database reads, frontend OpenID/UnionID references, location APIs, app-launch identity fetch, or registration-forced public consent.

### 15.3 Data Security

- Legacy mutation endpoints are now server-gated: tournaments, registrations, brackets, match results, free plays, courts, and seasons.
- New tournament write actions `create` and `updateNew` are also admin-gated before validation/persistence.
- Settings revoke/delete clears `rank:`, `home:`, `mine:`, `match:`, and `manage:` page caches.

### 15.4 Location

- No location permission/API usage was found by static scan.

## Verification Evidence

- `scripts: npm run audit:privacy`: passed.
- `miniprogram: npm test`: 34 suites, 336 tests passed.
- `cloudfunctions/members: npm test`: 2 suites, 42 tests passed.
- `cloudfunctions/tournaments: npm test`: 7 suites, 95 tests passed.
- `cloudfunctions/match-results: npm test`: 10 suites, 215 tests passed.
- `cloudfunctions/tournament-registrations: npm test`: 2 suites, 40 tests passed.
- `cloudfunctions/tournament-brackets: npm test`: 10 suites, 148 tests passed.
- `cloudfunctions/seasons: npx jest --runInBand`: 2 suites, 17 tests passed.
- `node --check` passed for `free-plays`, `courts`, `seasons`, and `privacy-adversarial-scan`.
- `git diff --check`: passed with LF/CRLF normalization warnings only.

## Remaining Operational Checks

- Deploy updated cloud functions before submitting review.
- Re-upload the mini-program package after deployment.
- Recheck the WeChat backend "用户隐私保护指引" in the review-version entrance, not only the online-version entrance.
- Run one live CloudBase deletion test account to confirm the production data volume and cache regeneration behavior.
