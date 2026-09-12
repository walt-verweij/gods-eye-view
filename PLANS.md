# Adoption plan: gods-eye-view

Joint plan from the Claude (Fable 5.1) and Codex sessions, 2026-09-11. Both reviews were
read-only; nothing here is implemented. Codex implements, Claude reviews diffs and reruns
checks independently. Feature branch per milestone, one writer per area, every milestone
mergeable on its own. Behaviour-preserving moves land a characterisation test first.

## Agreed diagnosis

- `src/ui.js` is one 187-method class (`StyleManager`, line 2187 to EOF) plus a 37-method
  `CockpitViewController` (line 655). 53 imports. It reaches into private layer-manager
  methods (line 5106). UI tests exist but execute extracted method bodies via `Function`
  (e.g. `src/mapSourceFocus.test.mjs:110`) or regex-match source text; nothing constructs
  the class.
- `vite.config.js` (7,800 lines) is the server in practice: `vite preview` serves app plus
  proxies. Dev/preview registration is uneven (CelesTrak :1598, OpenSky :3020 and CCTV :4600
  are dev-only; OpenAI :5329 is both). Setup endpoints are dev-only on purpose (:7639).
- SSRF defence is strong on radio (DNS pinning, private-range checks) and GBFS (allowlist)
  but the CCTV media (:4672) and frame (:4485) fetches have no destination, redirect or
  bounded-buffer controls; media also has no timeout. Registry-bound, not client-supplied,
  so a boundary gap rather than a demonstrated exploit.
- Two correctness findings: analyst engine treats null altitude as 0 in ascending queries
  (`src/data/analystEngine.js:90`, reproduced); UI disposal marks itself disposed before an
  awaited restore that can throw, skipping cleanup (`src/ui.js:10306`, source-level only).
- CI runs unit tests and build only. No browser check gates merges.
- Allocation-budget tests are pinned to Node 24 with documented headroom. Not proven flaky;
  measure before changing their status.
- Neither session could run the suite: host is Node 20 with no `node_modules`.

## Milestones

| # | Milestone | Size | Lane |
|---|-----------|------|------|
| 1 | Supported-runtime baseline | S | Claude |
| 2 | Correctness regressions | M | Codex |
| 3 | CCTV outbound boundary | M | Codex |
| 4 | Browser smoke gate in CI | M | Codex |
| 5 | Explicit dev/preview contract | M | Codex |
| 6 | Allocation-gate reliability audit | S | Claude |
| 7 | Provider extraction from vite.config.js | L | Codex |
| 8 | Cockpit controller extraction | M | Codex |
| 9 | Manager lifecycle boundary | M | Codex |
| 10 | StyleManager carve along event seams | L | Codex |
| 11 | Docs and handoff | S | Claude |

### 1. Supported-runtime baseline
Scope: none in code; TESTING.md note if anything diverges.
Why first: establish the real failure set before touching anything.
Check: on Node 24.14.0 run `npm ci`, `npm run doctor -- --json`, `npm test`, `npm run build`,
and `npm run test:track` when a browser is available. Record versions and every failure.

### 2. Correctness regressions
Scope: `src/data/analystEngine.js` and test; `src/ui.js` disposal path and a new test.
Why: one known wrong answer, one cleanup failure path. Separate PRs.
Check: missing altitude sorts after valid values and never yields a zero summary. Disposal
must first be reproduced (forced restore rejection); then a second disposal is safe and all
resources release. `npm test`.

### 3. CCTV outbound boundary
Scope: CCTV frame and media handlers; a small server transport module reusing the radio
proxy's private-range and DNS-pinning helpers; `src/cctvTransport.test.mjs`.
Why: fix the concrete gaps before any broad abstraction. Streaming limits belong here.
Check: injected DNS/transport tests for private IPv4/IPv6, redirects and rebinding, timeouts,
client-disconnect cancellation, image size caps, and legitimate range streaming. Preserve
provider-specific policies; document any intentional private-source exception.

### 4. Browser smoke gate in CI
Scope: `scripts/track-regression.mjs`, a focused Puppeteer smoke, `.github/workflows/ci.yml`.
Why: protect the integration seams before refactors start moving them.
Check: keyless fixture-driven startup, one layer toggle, tracking handoff, cockpit entry and
exit, no uncaught errors. CI installs the browser and shuts the server down.

### 5. Explicit dev/preview contract
Scope: one proxy-registration helper in `vite.config.js`; `src/proxyParity.test.mjs`.
Why: preview is what people run; today which feeds work there is accidental.
Check: the same fixture requests reach the intended handler under both servers; setup
routes stay absent in preview.

### 6. Allocation-gate reliability audit
Scope: evidence only unless instability is measured.
Check: 20 isolated runs per probe on the pinned CI runtime. Keep budgets if stable. If not,
make heap thresholds advisory and keep the deterministic cohort and work assertions.

### 7. Provider extraction from vite.config.js
Scope: `vite.config.js` to `server/proxies/*.mjs`, one provider per PR, cache ownership and
cleanup preserved. Route each through the milestone 3 transport policy where applicable.
Check: characterisation and parity suites green per PR; no existing protection weakened.

### 8. Cockpit controller extraction
Scope: `CockpitViewController` out of `src/ui.js` into its own module.
Check: construct, enter, exit and dispose under a DOM stub, plus the milestone 4 browser
gate. An import-only smoke is not enough.

### 9. Manager lifecycle boundary
Scope: `src/ui.js`, `src/data/manager.js`, context controller. Replace private-method
calls with a public manager API.
Check: supersession, failed restore, user overrides and teardown through the supported API.

### 10. StyleManager carve along event seams
Scope: split `StyleManager` one controller at a time along the existing `gev:*` CustomEvent
boundaries (cockpit mode, map stack, awareness subject, panels, keyboard).
Check: each extracted controller has a behaviour test; browser gate stays green.

### 11. Docs and handoff
Scope: TESTING.md, docs/CURRENT-STATE.md, SECURITY.md.
Check: fresh keyless startup follows the documented commands; localhost support is
distinguished from authenticated hosting. Add a server-side log redaction review and an
upstream-update strategy for the fork.

## Explicit non-goals

No framework rewrite. No blanket transport migration. No public-hosting authorisation.
Duplicate `clamp()` helpers are not worth a milestone.

## Status (2026-09-11)

All eleven milestones are merged on `plan/adoption-plan`; `main` is untouched and nothing is
pushed. Codex workers ran milestones 2a, 2b, 3, 4, 5, 7, 8, 9 and 10 in Orca child worktrees;
the coordinator ran 1, 6 and 11 and independently re-ran each milestone's checks before merging.

| # | Result |
|---|--------|
| 1 | Baseline on Node 24.14.0: 2,867 unit tests, 0 failures, build green |
| 2 | Analyst null-altitude and UI disposal bugs fixed with regression tests |
| 3 | `server/providers/common/cctv-transport.js`: pinned DNS, redirect re-validation, timeouts, byte cap, disconnect abort; operator LAN exception documented |
| 4 | `npm run test:smoke` plus the `browser-smoke` CI job; interval polling because SwiftShader stalls frames |
| 5 | `registerProxy` helper; every feed proxy serves in preview, key setup dev-only, pinned by `src/proxyParity.test.mjs` |
| 6 | Allocation probes 20/20 and 20/20 isolated runs; budgets stay hard gates, no code change |
| 7 | Superseded: upstream extracted providers to server/providers on 2026-09-12; our server/proxies layout dropped on rebase |
| 8 | `src/cockpitViewController.js` extracted verbatim with a DOM-stub characterisation test |
| 9 | Public manager lifecycle API; no private-member access from UI or voice code |
| 10 | Panel layout, keyboard focus and map-stack style controllers under `src/ui/`; `src/ui.js` 10,498 to 8,742 lines |
| 11 | TESTING.md, SECURITY.md, docs/CURRENT-STATE.md updated; log-redaction review and follow-ups in `BACKLOG.md` |

Final acceptance gate on the rebased branch (upstream base aacfa06, Node 24.14.0, 2026-09-12):
`GEV_REQUIRE_ALLOCATION_GATE=1 npm test` 2,974 tests, 2,973 pass, 1 skipped, 0 fail, both
allocation probes green; `npm run build` ok; `npm run test:smoke` 7/7 steps in 32 s and the
negative proof fails as required. The earlier integration branch `plan/adoption-plan` (old base
a547e99, including milestone 7) passed the same gate on 2026-09-11 and is kept for reference.
