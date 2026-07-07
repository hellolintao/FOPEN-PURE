# Appeal Materials - Privacy Remediation v2.1

## Summary

The latest remediation addresses the remaining privacy/data-rule risks in WeChat Mini Program Product Rule section 15. The fix focuses on actual data processing behavior, not only the privacy popup.

## Key Changes

1. Official privacy authorization remains in place for profile/avatar writes.
2. App launch no longer fetches member identity before the user enters member/account features.
3. Public real-identity display is optional and separate from basic registration.
4. Users without public-display consent are shown anonymously on public rankings, rosters, brackets, scores, H2H, and weekly-star surfaces.
5. Self-service deletion now removes/anonymizes member-related data across member, registration, match, bracket, point, rank, weekly-star, cache, and avatar-file records.
6. Public frontend pages no longer directly read the `tournaments` collection or compare OpenID fields.
7. Non-admin public reads sanitize internal identifiers such as OpenID-like fields, phone/admin flags, and public-consent metadata.
8. Legacy and new write endpoints are protected by server-side admin authorization.
9. Static privacy scan and automated tests were added to prevent regression.

## Verification

- Privacy adversarial scan: passed.
- Mini-program unit tests: 336 passed.
- Members cloud function tests: 42 passed.
- Tournaments cloud function tests: 95 passed.
- Match-results cloud function tests: 215 passed.
- Tournament-registrations cloud function tests: 40 passed.
- Tournament-brackets cloud function tests: 148 passed.
- Seasons cloud function tests: 17 passed.

## Submission Checklist

- Deploy changed cloud functions: `members`, `tournaments`, `match-results`, `tournament-registrations`, `tournament-brackets`, `free-plays`, `courts`, `seasons`.
- Upload a new mini-program version after cloud deployment.
- Update the review-version WeChat privacy guide so its declared categories match OpenID, nickname/avatar/play style, registration data, match/score data, ranking/points data, uploaded avatar images, public-display purpose, deletion/revoke rights, and retention/deletion handling.
- Attach screenshots for official privacy authorization, optional public-display consent, settings revoke/delete controls, anonymized public ranking/roster, and updated privacy policy/user agreement.
