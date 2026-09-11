# Backlog

Ordered follow-ups from the 2026-09-11 adoption plan (`PLANS.md`). Each item names why it
exists and what "done" looks like. None of these block the plan's milestones.

## 1. Server-side redaction for the Realtime debug log

`POST /api/realtime/debug-log` (`server/providers/local.js`) appends any JSON body,
up to 8 MB, to `.gev-logs/realtime-conversations.jsonl`. The browser redacts before posting;
the server does not. On a LAN-exposed instance any client can write arbitrary content into
that local file. Done: allowlist the record fields server-side and drop everything else, with a
test posting a body carrying `Authorization`, `apiKey` and a bearer token that proves none of
them reach disk. Found by the milestone 11 log-redaction review.

## 2. Error-path logging that can echo upstream URLs or config values

Same review. Conditional leaks only, all on error paths:

- `server/providers/gbfs.js` logs `error.message`; URL validation still admits userinfo on an
  allowed host, and a rejected URL is echoed whole. Done: reject userinfo, log a fixed code.
- `server/providers/aircraft/opensky.js` logs the raw OAuth `error_description`. Done: log status plus an
  allowlisted error code.
- `server/providers/local.js` (three CCTV sites) and `server/providers/firms.js` log raw parse or
  transport messages that can carry source snippets or echoed keys. Done: fixed codes only.
- `server/providers/aircraft/opensky.js`, `server/providers/vessels/ais-live.js` (via `src/data/aisWatchdog.js`),
  `scripts/dev-secure.sh` and `scripts/dev-fresh.sh` print an invalid configuration value in
  warnings; the launchers also print the absolute credentials-file path. Done: name the
  variable, not its value; print presence, not the path.

## 3. Route every proxy's outbound fetch through the outbound guard

Milestone 3 built `server/providers/common/cctv-transport.js`, but only CCTV frame and media
fetches and the radio proxy use its destination policy. Every
other provider module carries an `Outbound guard gap` header naming its unguarded fetches
(fixed public upstreams for most; OpenAI, Google Places, AISStream WebSocket, Nominatim, news
and weather for the rest). Done: one shared guarded-fetch helper, adopted provider by provider
with each module's header removed in the same commit; radio drops its private copy of DNS
pinning last.

## 4. Deeper StyleManager carve

Milestone 10 extracted three controllers (panel layout, keyboard focus, map-stack style) and
milestone 8 the cockpit view, but `src/ui.js` is still an 8,700-line class. Remaining seams
worth taking in the same characterisation-test-first pattern: awareness subject selection
(`gev:awareness-subject-selected`), context mode and Contacts, share-link restore, and the
detection and HUD wiring. Done when no single controller in `src/ui.js` exceeds roughly 2,000
lines and each extracted piece constructs under the DOM stub used by
`src/cockpitViewController.test.mjs`.

## 5. Node 20 hang in the unit runner

`node --test` on Node 20 spins forever inside `src/annotations/annotationEngine.test.mjs`.
Node 20 is outside `engines`, so this is a footgun rather than a bug. Done: `npm run doctor`
warns on Node < 24 and the runner refuses to start there.

## Status block (2026-09-11, end of the adoption-plan session)

- Done: milestones 1 through 11 of `PLANS.md`, merged on branch `plan/adoption-plan`
  (2a, 2b, 3, 4, 5, 7, 8, 9, 10 as Codex worker branches; 1, 6 and 11 by the coordinator).
- Verification at acceptance: full unit suite with allocation gate, `npm run build` and
  `npm run test:smoke` on Node 24.14.0 on the integration branch.
- Known issues: items 1 to 5 above. Nothing is pushed; `main` is untouched.
- Next action: open a pull request from `plan/adoption-plan` and run the `browser-smoke` CI
  job on the x86 runner, which this ARM host cannot stand in for.
