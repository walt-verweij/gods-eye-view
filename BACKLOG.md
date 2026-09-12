# Backlog

Ordered follow-ups from the 2026-09-11 adoption plan (`PLANS.md`). Each item names why it
exists and what "done" looks like. None of these block the plan's milestones.

## 1. Server-side redaction for the Realtime debug log (done 2026-09-12)

`/api/realtime/debug-log` now keeps only the browser writer's record fields and scrubs API keys, bearer
tokens, client secrets and image data URLs before writing; `src/realtimeDebugLog.test.mjs` posts a body
carrying all four and proves none reach disk.

## 2. Error-path logging that can echo upstream URLs or config values (done 2026-09-12)

Every listed site now logs a fixed code or the variable name and presence only; GBFS rejects userinfo in
upstream URLs; `src/serverLogRedaction.test.mjs` pins each site. Launchers print presence, not paths.

## 3. Route every proxy's outbound fetch through the outbound guard (done 2026-09-12)

`server/providers/common/outbound-guard.js` (`guardedFetch`): DNS resolved once and validated against the
shared address classifier, manual redirect re-validation (max 3), provider timeouts and optional byte caps.
Every HTTP provider uses it; injected `fetchImpl` and the current `globalThis.fetch` remain the transport so
existing test seams hold, and only CCTV media and Radio Browser use the pinned raw transport they had before.
The AISStream WebSocket is out of scope and says so in its header. `src/outboundGuard.test.mjs` covers both
transports.

## 4. Deeper StyleManager carve

Milestone 10 extracted three controllers (panel layout, keyboard focus, map-stack style) and
milestone 8 the cockpit view, but `src/ui.js` is still an 8,700-line class. Remaining seams
worth taking in the same characterisation-test-first pattern: awareness subject selection
(`gev:awareness-subject-selected`), context mode and Contacts, share-link restore, and the
detection and HUD wiring. Awareness selection is now extracted; the Display controller owns
detection/HUD toggle and readout wiring, while Context/Contacts and share restore remain.
Context/Contacts cannot move as one seam because `_contextModeChanging`, `_contextSessionSnapshot`,
`_contextRestoreState`, `_contextModeEntryIntent`, and `_contextModeReplacementIntent` form one
transaction shared by visibility guards, restore replay, cockpit exits, panel state, and voice.
Share restore cannot move as one seam because the `ShareLinkManager.applyState` constructor
callback mutates visual controls, panels, navigation, and layer-state restoration, while visual
restore-lane claims are distributed across those independent owner paths. Done when the extracted
awareness and Display controllers retain their characterisation coverage, and the remaining
Context/Contacts and share-restoration transactions have first been split into real ownership
boundaries; each extracted piece must construct under the DOM stub used by
`src/cockpitViewController.test.mjs`.

## 5. Node 20 hang in the unit runner (done 2026-09-12)

`scripts/run-unit-tests.mjs` now refuses any engine below 24.14 with an explicit message
instead of hanging; `npm run doctor` already reported it as an error.

## Status block (2026-09-11, end of the adoption-plan session)

- Done: milestones 1 through 11 of `PLANS.md`, merged on branch `plan/adoption-plan`
  (2a, 2b, 3, 4, 5, 7, 8, 9, 10 as Codex worker branches; 1, 6 and 11 by the coordinator).
- Verification at acceptance: full unit suite with allocation gate, `npm run build` and
  `npm run test:smoke` on Node 24.14.0 on the integration branch.
- Known issues: items 1 to 5 above. Nothing is pushed; `main` is untouched.
- Next action: open a pull request from `plan/adoption-plan` and run the `browser-smoke` CI
  job on the x86 runner, which this ARM host cannot stand in for.
