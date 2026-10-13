# Apply Progress: debt-management

Mode: Strict TDD. Delivery: auto-chain, stacked-to-main, review budget 800 lines. Later batches MUST merge into this file.

## Batch 1: S0a (Nia in-repo) - COMPLETE (size:exception, mechanical move)

Branch `feat/debt-s0a-nia-in-repo`. Commit `de7b7cd chore(nia): track functions/nia as plain files`.

### Owner confirmation (S0a.1 gate)
The owner explicitly confirmed in chat on 2026-10-12 to back up and remove the nested `functions/nia/.git` and integrate Nia as plain files. Gate satisfied before any destructive step. Include this text in the PR description.

### Preflight (S0a.2)
- `git ls-files -s functions/nia`: `160000 887fe1189c050cec3c718273ab8dc2f391d8bb67`.
- `git -C functions/nia rev-parse --show-toplevel` = the nested root (`.../functions/nia`).
- Nested `rev-parse HEAD` = `887fe1189c050cec3c718273ab8dc2f391d8bb67` (`887fe11 init`).
- Nested `status --porcelain`: ` M README.md`, ` M index.js`, ` M package.json`, `?? node_modules/` (uncommitted changes preserved in the new tracked blobs).

### Backup (S0a.4)
- Primary: `C:\Users\USER~1.ADM\AppData\Local\Temp\claude\C--Users-User-admin-Documents-Personal-FinanzasPlus\80d850eb-574b-4a14-be99-7b0ab5513e1e\scratchpad\nia-git-backup\` (`.git/`, `index.js`, `README.md`, `package.json`, `nia.bundle`). The scratchpad is temporary.
- Durable copy: `C:\Users\User.admin\backups\finanzasplus-nia-git-20261012\` (same contents).
- Verified before deletion: `git --git-dir=<backup>/.git log --oneline` shows `887fe11 init`; `git bundle verify nia.bundle` is okay (refs master, origin/master, HEAD at 887fe11, complete history); the three files are byte-identical to the working tree (`cmp`); sha256 of the working-tree files was recorded and matched after staging.

### Tasks
- [x] S0a.1 owner gate (confirmation recorded above)
- [x] S0a.2 preflight
- [x] S0a.3 RED `src/test/niaInRepo.test.js` (7 tests; 7 failed first for the right reason: pathspec in submodule / gitlink 160000 present / nested `.git` present / dockerignore lacks `dist-nia`)
- [x] S0a.4 backup (see above)
- [x] S0a.5 `git rm --cached functions/nia`, removed `functions/nia/.git`, staged `index.js`, `package.json`, `README.md` by explicit path (no lockfile exists)
- [x] S0a.6 `git rm --cached functions/nia.tar.gz functions/nia-deploy.tar.gz` (files kept on disk); `.gitignore` += `dist-nia/`; `.dockerignore` += `dist-nia`, `**/dist-nia` (`packages` not listed, so it stays in the context)
- [x] S0a.7 `npm test` and `npm run build` green; committed

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| S0a.3/5/6 | `src/test/niaInRepo.test.js` | Unit (node env, real git via `execFileSync`, no shell) | Full suite baseline 187/187 (first run had 3 timeouts under load, rerun 187/187) | Written first; 7/7 failed | 7/7 passed after index change + ignore files | 7 cases: blobs 100644, no 160000 under `functions/`, no nested `.git`, no `node_modules`/`*.tar.gz` tracked, tarballs and `dist-nia` ignored, sources not ignored, dockerignore | None needed (test already minimal) |

Test summary: 7 tests written, 7 passing; full suite 30 files / 194 tests passing. Pure functions created: 0 (test helpers only).

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test | `npx vitest run src/test/niaInRepo.test.js`: exit 0, 7 passed |
| Runtime harness | `git ls-files -s functions`: only 100644 entries (`nia/README.md`, `nia/index.js`, `nia/package.json`); `npm run build` exit 0 (built in 7.25s); `npm test` exit 0 (30 files, 194 tests) |
| Rollback boundary | Restore `.git` from the backup, `git rm -r --cached functions/nia`, `git update-index --add --cacheinfo 160000,887fe1189c050cec3c718273ab8dc2f391d8bb67,functions/nia`; revert `.gitignore`, `.dockerignore`, remove `src/test/niaInRepo.test.js` |

### Notes
- Git reports LF-to-CRLF warnings (autocrlf); blobs are stored normalized, working-tree bytes unchanged.
- `.codegraph/` and `.claude/` left untracked on purpose (not in S0a scope).
- Pre-existing flakiness: under a loaded machine the jsdom suite can hit 15 s timeouts on 1-3 tests; a rerun passed 187/187.
- Size checkpoint: mostly moved Nia files (about 1,100 lines); accepted `size:exception`.

## Batch 2: S0b (Nia packaging script) - COMPLETE

Branch `feat/debt-s0b-nia-packaging` (stacked on `feat/debt-s0a-nia-in-repo`). Commits:
- `b48dae9 feat(nia): add in-process ustar writer for the Function archive`
- `c043bb5 feat(nia): add package:nia script that bundles the Function for Node 16`
- `025941c docs(nia): document npm run package:nia and the separate Function deployment`

Size: 582 added / 4 deleted lines across 8 files (tests and docs included); well under the 800-line budget, no split needed.

### Tasks
- [x] S0b.1 RED `scripts/lib/tar.test.js` (module missing -> suite failed to import)
- [x] S0b.2 GREEN `scripts/lib/tar.mjs` (`createTar`, `createTarGz`; 8 tests)
- [x] S0b.3 RED `scripts/package-nia.test.js` (module missing -> suite failed to import)
- [x] S0b.4 GREEN `scripts/package-nia.mjs` (`packageNia`, `scanForbiddenApis`, CLI with `--out` and `--entry`)
- [x] S0b.5 `"package:nia": "node scripts/package-nia.mjs"` (RED test first: script undefined)
- [x] S0b.6 docs (Spanish): `docs/setup.md` section 5 item 4, `docs/deploy.md` new section 8, `functions/nia/README.md` (Empaquetado + env var table)
- [x] S0b.7 REFACTOR, full suite and size checkpoint

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| S0b.1/2 | `scripts/lib/tar.test.js` | Unit (node env) | N/A (new) | Written first; suite failed (module missing) | 8/8 passed | 8 cases: header fields and checksum, 512 padding plus 2 zero end blocks, empty file, determinism, explicit mode/mtime, name limit (101 bytes, exactly 100, multibyte), empty/absolute/`..` names, gzip round trip | None needed |
| S0b.3/4 | `scripts/package-nia.test.js` | Unit + subprocess integration (real Vite build via `execFileSync(process.execPath)`, no shell; bundle loaded in a child Node process) | Baseline 194/194 | Written first; suite failed (module missing) | 10/10 passed | Scan positive and negative cases; import-specifier check has a negative control (relative and `packages/` paths flagged); tarball vs dist byte equality; fixture with `findLast` exits non-zero and writes no tarball | None needed |
| S0b.4 (fix) | same | same | 10/10 | Added "dist-nia holds only index.js and package.json": failed because Vite copied web `public/` assets (5 files) into the bundle dir | 11/11 after `publicDir: false` | n/a | n/a |
| S0b.5 | same (`npm script` describe) | Unit | `package.json` read | Failed: script undefined | 12/12 passed | Triangulation skipped: single constant string, one possible output | n/a |

Test summary: 20 tests written (8 tar + 12 packaging); full suite 32 files / 214 tests passing (baseline 30 files / 194). Pure functions created: 3 (`createTar`, `createTarGz`, `scanForbiddenApis`).

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test | `npx vitest run scripts/`: exit 0, 3 files, 23 tests passed (includes pre-existing script tests); `scripts/lib/tar.test.js` 8/8, `scripts/package-nia.test.js` 12/12 |
| Runtime harness | `npm run package:nia` exit 0 wrote `functions/nia.tar.gz` (14,837 bytes: `index.js` 56,814 + `package.json` 182, listed by the system `tar -tzvf`); the bundle loaded in a child Node process with stubbed env and `undici@5.28.5` linked in, GET returned `{ok:true, service:'nia'}`; `npm test` 214/214; `npm run build` exit 0; `git status` shows no tarball or `dist-nia` noise (`functions/*.tar.gz` and `dist-nia/` ignored, confirmed with `git check-ignore -v`) |
| Rollback boundary | Remove `scripts/package-nia.mjs`, `scripts/package-nia.test.js`, `scripts/lib/tar.mjs`, `scripts/lib/tar.test.js`, the `package:nia` line in `package.json`, and revert the three doc files (`docs/setup.md` item 4, `docs/deploy.md` section 8, `functions/nia/README.md`) |

### Deviations and decisions
- The bundle API scan excludes `.at(` on purpose: Node 16.6+ ships it and `functions/nia/index.js` already uses it (`message.photo.at(-1)`, `sorted.at(-1)`); including it would fail the existing code and the task forbids refactoring Nia here. The finance-core `.at(` rule stays in S1.9's own static test. Scan list: `findLast`, `findLastIndex`, `toSorted`, `toReversed`, `toSpliced`, `.with(`, `structuredClone`, `Object.groupBy`, `Map.groupBy`.
- Added `publicDir: false` to the Vite build (not in AD12): without it Vite copied `public/` web assets into `dist-nia/`. Covered by a dedicated test.
- Added a test-only `--entry <file>` CLI flag and an `entry` option on `packageNia` so the forbidden-API failure can be exercised end to end with a fixture; default is `functions/nia/index.js`.
- `scanForbiddenApis` is exported; `vite` is imported lazily inside `packageNia`, so importing the module is cheap.
- The smoke test loads the bundle in a child Node process (explicit minimal env, `node_modules/undici` junction to the pinned 5.28.5 resolved from `functions/nia`), not inside Vitest, so no env seam or refactor of `functions/nia/index.js` was needed. `undici` is pinned: the script throws if `functions/nia/package.json` has a range instead of an exact version.
- Docs: `setup.md` no longer recommends the GitHub root `functions/nia` (S8 will inline `packages/` through relative imports, which that mode could not resolve); the tarball upload is the documented path. The old text claimed the tarball held `README.md`; the generated one holds only `index.js` and `package.json`.

### Notes
- `npm run package:nia` regenerated the local, untracked `functions/nia.tar.gz` (OA-4: owner uploads it after merge). `functions/nia-deploy.tar.gz` is untouched.
- Pre-existing flakiness persists: the first full-suite run of the session hit 2 jsdom timeouts under load; the rerun passed 194/194.
- The Node version used here is 24; the Node 16 guarantees come from the Vite `target`, the API scan and the static `node:`/`undici` import check, not from executing on Node 16.

## Batch 3: S1 (core foundation: money, calendar, rates, legal) - COMPLETE

Branch `feat/debt-s1-core-rates` (stacked on `feat/debt-s0b-nia-packaging`). Commits (each one a green, reviewable work unit):
- `98e3dc8 feat(finance-core): add money and calendar primitives` (505 lines)
- `7113c15 feat(finance-core): add interest rate conversion` (431 lines)
- `4328929 feat(finance-core): add legal notices, public barrel and Node 16 guard` (406 lines)

Size: 1,342 added / 0 deleted lines across 12 files (src 485, barrel 23, tests 834). The forecast was 520, so the 800-line slice budget is exceeded by about 540 lines. The design lists no overflow valve for S1; the three commits above are natural cut points (505 / 431 / 406, each under 800) if the orchestrator or owner prefers stacked sub-slices S1a/S1b/S1c over a `size:exception`. Decision pending (not taken here).

### Tasks
- [x] S1.1 RED `packages/finance-core/test/money.test.js` (suite failed: `src/errors.js` missing)
- [x] S1.2 GREEN `src/money.js` (+ `src/errors.js` with `ValidationError`)
- [x] S1.3 RED `test/calendar.test.js` (suite failed: `src/calendar.js` missing)
- [x] S1.4 GREEN `src/calendar.js`
- [x] S1.5 RED `test/rates.test.js` + `test/helpers/prng.js` (suite failed: `src/rates.js` missing)
- [x] S1.6 GREEN `src/rates.js`
- [x] S1.7 RED `test/legal.test.js` (suite failed: `src/legal.js` missing)
- [x] S1.8 GREEN `src/legal.js`; `USURY_TABLE` holds the single known consumer cap (28.59% EA, 2026-10-01..2026-10-31, secondary source, `verified:false`); `SMMLV_TABLE` empty placeholder (OA-5 still open)
- [x] S1.9 RED `test/node16.test.js` (suite failed: `index.js` barrel missing)
- [x] S1.10 GREEN and REFACTOR `index.js` barrel; size checkpoint run (see above); full `npm test`

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| S1.1/S1.2 | `packages/finance-core/test/money.test.js` | Unit (node env) | N/A (new) | Written first; suite failed to import `errors.js` | 13/13 passed | Positive and negative halves, unit 1 and 100, -0 normalisation, integer/NaN/Infinity/string/2^60 rejections, empty vs non-empty sums, error code and field label | None needed |
| S1.3/S1.4 | `test/calendar.test.js` | Unit (node env) | N/A (new) | Written first; suite failed to import `calendar.js` | 23/23 passed | Leap and non-leap clamps, anchor-day recovery (02-28 -> 03-31), year rollover both directions, all 7 periodicities, 36-period schedule, invalid inputs | Extracted `hasPeriodicity` (own-key check, replaces `Object.hasOwn` which is Node 16.9+); added a test for it afterwards (24/24) |
| S1.5/S1.6 | `test/rates.test.js` + `test/helpers/prng.js` | Unit + seeded property (node env) | N/A (new) | Written first; suite failed to import `rates.js` | 24/24 passed | Spec scenarios (24% EA -> 0.0180875824835107, 2.1% MV and 25.2% NAMV -> 28.3243% EA, 2% monthly anticipated = 0.02/0.98, ZERO -> 0/0), invalid anticipated 100%/150%/nominal-equivalent, negatives/NaN/Infinity/strings, 6x6x25 = 900 convention round trips and 2x7x2x20 = 560 basis/periodicity/timing round trips within 1e-9 (case counts asserted) | None needed |
| S1.7/S1.8 | `test/legal.test.js` | Unit (node env, tables injected) | N/A (new) | Written first; suite failed to import `legal.js` | 13/13 passed | Above/below/at cap, validity window boundaries (10-31 vs 11-01), no cap entry, bad input never throws, unverified flag, shipped table defaults, mortgage vs consumer/card Ley 1555 | None needed |
| S1.9/S1.10 | `test/node16.test.js` | Static scan + barrel (node env) | N/A (new) | Written first; suite failed to import `index.js` | 8/8 passed | Scanner self-checks (11 positives, regex-v positives, clean negatives), real sources scanned (file list asserted, not empty), import specifiers all relative with `.js`, exact barrel key list. Mutation check: a temporary `src/zz_tmp.js` containing `.at(-1)` and `findLast` made the scan test fail, then was deleted | None needed |

Test summary: 82 tests written (13 + 24 + 24 + 13 + 8), 82 passing; full suite 37 files / 296 tests passing (baseline after S0b: 32 files / 214). Pure functions created: 17 (3 money, 7 calendar incl. `hasPeriodicity`, 5 rates, 2 legal) plus the `mulberry32` test helper.

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test | `npx vitest run packages/finance-core`: exit 0, 5 files, 82 tests passed |
| Runtime harness | N/A: pure functions with no runtime boundary; the seeded property tests (1,460 round-trip cases) are the harness. `npm test` exit 0 (37 files, 296 tests; two earlier full runs showed 3 and then 1 unrelated jsdom timeouts under load, rerun clean); `npm run build` exit 0 |
| Rollback boundary | Delete `packages/finance-core/` (12 files; nothing else in the repo imports it yet) |

### Deviations and decisions
- Added `src/errors.js` (`ValidationError` with a stable `code`): not in the design's file table, but the spec requires a "typed validation error" and every module needs it. Exported from the barrel.
- Rate model: `Rate = {value, basis, periodicity, timing}` exactly as designed. `effective` + non-annual periodicity is the per-period rate (so `2.1% MV` is `{2.1, effective, monthly, arrears}` and `2% monthly anticipated` is `{2, effective, monthly, advance}`); `nominal` is the annual rate compounded `periodicity` times a year (NAMV, NATV, NATA, NAMA). Interest-free (ZERO) is the rate 0% EA, so no extra basis value was added.
- Units: `periodicRate` returns a fraction (0.018 = 1.8%); `toEffectiveAnnual` and `convertRate().value` use percent units like `Rate.value`. Documented in JSDoc.
- Weekly = 52 and biweekly = 26 periods per year for rate compounding, while biweekly dates are 14 days apart (design open question on `semimonthly` unchanged).
- `normalizeRate` also accepts `{convention, value}`; `convertRate` accepts a convention name or `{basis, periodicity, timing}`; `usuryNotice(rate, modality, asOf, {usuryTable})` takes an optional injected table (design signature plus a fourth options argument). Notices never throw: invalid rate, invalid `asOf` or missing cap all return `null`.
- Notice `message` strings are English; the structured fields (`code`, `capEA`, `asOf`, `verified`, `scopeVerified`) are the contract and UIs can localise by `code`.
- `periodDates` takes an optional fourth `anchorDay` argument. `PERIODICITIES` (with `perYear`) is exported from the barrel.
- Node16 scan: scans production sources (`index.js`, `src/**`), not `test/` (the tests must name the forbidden APIs). It is a superset of the S1.9 list: also `findLastIndex`, `toSpliced`, `.with(`, `Map.groupBy`, `Object.hasOwn`. Extra check: every import in the core is relative with an explicit `.js` extension (dependency-free, browser-safe).
- Vitest needed no config change: the default include already discovers `packages/**/*.test.js`. All finance-core tests carry `// @vitest-environment node` (pure code, no DOM).
- OA-5 is still open: only the single secondary-source consumer cap is shipped (`verified:false`); `SMMLV_TABLE` is an empty placeholder and nothing reads it yet.

### Notes
- Date range: `isIsoDate` accepts years 1000..9999 only (4-digit years below 1000 would be misread by `Date.UTC`).
- `rounded + 0` in `roundUnit` is deliberate (turns -0 into 0, tested).

## Batch 4: S2 (terms, amortization schedules, charges) - COMPLETE

Branch `feat/debt-s2-schedules` (stacked on `feat/debt-s1c-legal-barrel`). Four work-unit commits, each green on its own (tests + implementation together):
- `fd6e9a5 feat(finance-core): add debt terms validation, serialization and versioning` (484 lines)
- `fff96e2 feat(finance-core): add French amortization schedule` (292 lines)
- `146bdf0 feat(finance-core): add German, bullet, interest-only and manual systems with grace periods` (463 lines)
- `d96d40c feat(finance-core): add per-installment charges, taxes and real-cost totals` (476 lines)

Size: 1,715 changed lines summed over the four commits (1,656 added / 1 deleted net against the S1 head, 19 files: src+barrel 670, tests 900, fixtures 86). The forecast was 740, so the 800-line budget is exceeded by the work unit as a whole; the owner-approved policy (work unit up to 2000 lines, stacked PRs of at most 800) is used. Proposed stacked PR grouping (the orchestrator creates the branches):

| PR sub-branch (proposed) | Commits | Lines |
|---|---|---|
| `feat/debt-s2a-terms-french` | `fd6e9a5`, `fff96e2` | 776 |
| `feat/debt-s2b-systems-grace` | `146bdf0` | 463 |
| `feat/debt-s2c-charges` | `d96d40c` | 476 |

Merging B and C into one PR would be 939 lines (over 800), hence three PRs. The design's pre-declared S2a/S2b valve (terms + French/German + totals vs the rest) was not used because it does not fit the final code layout.

### Tasks
- [x] S2.1 RED `test/terms.test.js` (suite failed: `src/terms.js` missing)
- [x] S2.2 GREEN `src/terms.js` (+ `TermsTooLarge` in `src/errors.js`)
- [x] S2.3 RED `test/schedule.french.test.js` + `test/fixtures/french-10m-24ea-36.json` (suite failed: `src/schedule/index.js` missing)
- [x] S2.4 GREEN `src/schedule/index.js` (`buildSchedule`), `french.js`, `row.js`
- [x] S2.5 RED `test/schedule.systems.test.js` (18/18 failed first: builders for the other systems missing)
- [x] S2.6 GREEN `german.js`, `bullet.js`, `interestOnly.js`, `manual.js`, `grace.js`; French now delegates grace to `grace.js`
- [x] S2.7 RED `test/charges.test.js` + `test/fixtures/libranza-10m-15mv-24.json` (suite failed: `src/charges.js` missing)
- [x] S2.8 GREEN `src/charges.js` (`evaluateCharges`), charges integrated into rows, `summarizeSchedule`
- [x] S2.9 REFACTOR and size checkpoint: `schedule/index.js` split into `dueDates` and `addCharges` helpers, barrel exports, barrel exact-keys test, `npm test`, `npm run build`

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| S2.1/S2.2 | `packages/finance-core/test/terms.test.js` | Unit (node env) | Existing core suite 82/82 before touching `errors.js` and the barrel | Written first; suite failed to import `terms.js` | 18/18 passed | Defaults vs explicit values, balance-only debt, manual-plan derivation; rejection groups (principal, anticipated rate on `rate` and `lateRate`, dates, kind/system/periodicity/n, schema version, grace, balloon, manual plan), charge normalisation and 7 malformed-charge cases, 120-row manual plan fits vs 400 rows `TermsTooLarge`, round trip, v0 -> v1 migration, future schema, bad JSON | None needed; barrel RED first (exact-keys test failed), then exports |
| S2.3/S2.4 | `test/schedule.french.test.js` + `fixtures/french-10m-24ea-36.json` | Unit + golden fixture | 100/100 (core suite) | Written first; suite failed to import `schedule/index.js` | 16/16 passed first run | Canonical 10M/24% EA/36 (rows 1, 2, 35, 36 and totals vs the fixture, spec bounds +/-1 and <=36), 0% loan, quarterly, anticipated monthly, rounding unit 100, month-end anchor, single installment, `fromPeriod`/`balanceMinor`/`startDate` rebuild, no rows for `system:'none'`, invalid options | Dispatch separated from the builder; barrel RED first |
| S2.5/S2.6 | `test/schedule.systems.test.js` | Unit + seeded property (200 cases) | 116/116 (core suite) | Written first; 18/18 failed (builders missing) | 19/19 passed (135/135 core) | German (even and uneven split, monotonicity), bullet (n=3, n=1, 0%), interest-only (default balloon, 5M balloon, partial amortization above the balloon), manual (plan, overshoot, interest split, below-interest error, rebuild, startDate ignored), grace (total, principal-only, German, 0%, rebuilt tail), property 200 cases = 40 per system asserting sums, closing 0, whole numbers, non-negative balances/interest/installments, non-negative principal outside capitalizing rows. Mutation check: breaking the interest-only residual made 4 tests fail, then reverted | `french.js` now uses `buildGraceRows`; the `unsupported_system` branch was removed once all builders existed |
| S2.7/S2.8 | `test/charges.test.js` + `fixtures/libranza-10m-15mv-24.json` | Unit + golden fixture + seeded property (200 cases) | 135/135 (core suite) | Written first; suite failed to import `charges.js` | 20/20 passed first run (155/155 core) | GMF 1,600 on 400,000; IVA 1,900 on a 10,000 fee (11,900 together); evaluation order independent of listed order (GMF 1,648 on 411,900); all six bases; rounding unit; annual 600,000 for periods 1 and 13 (range 1-24 on 36 months), annual on quarterly periodicity and with an anchor, once, ranges; pctOfCharge skipped when its reference is not billed; libranza rows 1, 2, 24 and totals vs fixture; charges never change principal; bundled = itemized totals; charges billed during total grace; `summarizeSchedule` on the fixture and on `[]`; reconciliation over 200 seeded schedules (4 systems, random charge sets) | Extracted `dueDates` and `addCharges`; barrel RED first |

Test summary: 73 tests written (18 + 16 + 19 + 20), 73 passing; core suite 9 files / 155 tests; full suite 41 files / 369 tests passing (S1 baseline 37 files / 296; the first full run showed 2 unrelated jsdom timeouts under load, the rerun was clean 369/369, the same pre-existing flakiness as earlier batches). Pure functions created: 16 (`validateTerms`, `serializeTerms`, `parseTerms`, `buildSchedule`, `summarizeSchedule`, `evaluateCharges`, `levelPayment`, `interestFor`, `makeRow`, `withCharges`, `buildFrench`, `buildGerman`, `buildBullet`, `buildInterestOnly`, `buildManual`, `buildGraceRows`).

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test | `npx vitest run packages/finance-core/test/schedule.french.test.js packages/finance-core/test/schedule.systems.test.js packages/finance-core/test/charges.test.js packages/finance-core/test/terms.test.js`: exit 0, 4 files, 73 tests passed (`npx vitest run packages/finance-core`: 9 files, 155 tests) |
| Runtime harness | N/A: pure functions with no runtime boundary; golden fixtures (French canonical, libranza with insurance + fee + IVA + GMF) and the seeded property tests (200 cases for the systems, 200 for the charge totals) are the harness. `npm test` exit 0 (41 files, 369 tests); `npm run build` exit 0 |
| Rollback boundary | Delete `packages/finance-core/src/terms.js`, `src/schedule/`, `src/charges.js`, the `TermsTooLarge` class in `src/errors.js`, the S2 exports in `index.js`, the S2 test files and `test/fixtures/`, and the S2 entries of the barrel/scan lists in `test/node16.test.js` (nothing outside `packages/finance-core/` imports them yet) |

### Deviations and decisions
- **Negative principal for capitalized interest.** Total grace rows and non-final bullet rows have `principalMinor = -interest`, `installmentMinor = 0` and `closing = opening + interest`. This is the only way to satisfy at once "principal sums to P", "balance after grace exceeds P" and "final balance 0". The task's "integers >= 0" property therefore holds for principal everywhere except in capitalizing rows; the property test encodes that. `interestMinor` on such a row is the interest accrued (not paid); `costMinor` is the cost of the period (interest accrued + charges + taxes).
- **Bullet** is modelled as a single payment at maturity with interest capitalized every period (compound); n=1 is principal plus one period of interest.
- **Interest-only with balloon**: the balloon defaults to the whole principal; any amount above the balloon is amortized in equal shares over periods 1..n-1 with the rounding residue in period n-1, so the last principal is exactly the balloon. A balloon is only accepted for `interest_only` (`balloon_unsupported` otherwise; French/German leasing with a residual value is not modelled in S2).
- **Grace** is accepted for French and German only (`grace_unsupported` for the rest); it is counted on absolute period numbers so rebuilt tails stay consistent; `periods` must be below `n`.
- **Manual plan**: tuple amounts are the planned installment (principal + interest); interest accrues at the periodic rate for the debt's periodicity on the balance; the last row settles the remainder and principal never exceeds the balance. A non-final amount below the accrued interest throws `manual_plan_below_interest` from `buildSchedule`. `n` and `firstDueOn` are derived from the plan; `startDate` is ignored for manual plans.
- **`buildSchedule` options**: `fromPeriod` (first row to build), `balanceMinor` (its opening balance), `startDate` (its due date). Charges use absolute period numbers.
- **Charges**: `anchorMonth` from the design's Charge shape is not implemented (no spec scenario needs it); annual cadence is anchored on `fromPeriod`. `pctOfCharge` may only reference an earlier, non-`pctOfSubtotal` charge (validated; keeps evaluation acyclic). The subtotal for `pctOfSubtotal` is the installment plus all charges and taxes from the first two groups, so GMF applies to IVA too. `fixed` charges are exact pesos (not rounded to the unit); percentage charges round to `roundingUnit`. Zero-amount lines are omitted. Each charge line also carries `display` so presentation can bundle or itemize; totals are identical either way.
- **Row shape additions**: `costMinor` (interest + charges + taxes) beyond the design's `ScheduleRow`; `summarizeSchedule` returns `{count, principalMinor, interestMinor, chargesMinor, taxesMinor, installmentsMinor, totalDueMinor, costMinor}`; `totalDueMinor` reconciles exactly (not just +/-1) with principal + interest + charges + taxes.
- **Terms**: `validateTerms` returns a normalized copy and never mutates its input; `TermsTooLarge` extends `ValidationError` (code `terms_too_large`); `parseTerms` treats a document without `schemaVersion` as version 0 and migrates it. `periodicity` is required except for `system:'none'`. `principalMinor` must be positive except for kind `card`. Kinds accepted: consumer, vehicle, libranza, mortgage, leasing, family, informal, card, other. `card` (S7) is only checked to be an object.
- **Public barrel** now also exports `TermsTooLarge`, `TERMS_SCHEMA_VERSION`, `TERMS_MAX_CHARS`, `validateTerms`, `serializeTerms`, `parseTerms`, `buildSchedule`, `summarizeSchedule`, `evaluateCharges`; the exact-keys test in `test/node16.test.js` was updated first (RED) in each commit.
- The golden fixtures are independently computed (floating-point reference, half away from zero per component) and labelled as such; OA-6 (real statements) is still open.

### Notes
- Git warns about LF-to-CRLF conversion on every add (autocrlf); blobs are normalized, nothing to do.
- Authored review size excluding fixtures: PR A 753, PR B 463, PR C 413.

## Batch 5: S3a (ledger events, allocation, projection, commit) - COMPLETE

Branch `feat/debt-s3a-ledger` (stacked on `feat/debt-s2c-charges`). Four work-unit commits, each green on its own (tests + implementation together):
- `1dc3c93 feat(finance-core): add ledger events and payment allocation` (533 lines)
- `675d0b0 feat(finance-core): add deterministic debt projection with plan statuses` (512 lines)
- `10dabad feat(finance-core): project extra payments, rate and charge changes, restructures and adjustments` (697 lines)
- `85ad78b feat(finance-core): add idempotent commit plan for debt events and cost rows` (515 lines)

Size: 2,233 changed lines summed over the four commits (2,222 added / 11 deleted, 18 files: src 770, tests 1,320, barrel/errors/schedule additions about 140). The forecast was 760 and the owner ceiling for the work unit is 2,000, so this **exceeds the ceiling by about 233 lines**; the per-PR budget (800) holds in every proposed PR. Merging any two commits would break 800 (the smallest pair is 1,027), hence four PRs:

| PR sub-branch (proposed) | Commits | Lines |
|---|---|---|
| `feat/debt-s3a1-events-allocate` | `1dc3c93` | 533 |
| `feat/debt-s3a2-projection` | `675d0b0` | 512 |
| `feat/debt-s3a3-plan-changes` | `10dabad` | 697 |
| `feat/debt-s3a4-commit` | `85ad78b` | 515 |

### Tasks
- [x] S3a.1 RED `test/ledger/events.test.js` (suite failed: `events.js` missing)
- [x] S3a.2 GREEN `src/ledger/events.js` (`EVENT_KINDS`, `validateEvent`, `activeEvents`, `sortEvents`); `normalizeCharges` exported from `terms.js` for `charge_change` validation
- [x] S3a.3 RED `test/ledger/allocate.test.js` (suite failed: `allocate.js` missing)
- [x] S3a.4 GREEN `src/ledger/allocate.js` (`allocate`, `allocateSplit`, `BUCKETS`)
- [x] S3a.5 RED `test/ledger/project.test.js` and `project.terms.test.js`, plus 5 `installmentMinor` tests in `schedule.french.test.js` (suites failed: `project.js` missing; 4 of the 5 schedule tests failed first, the fifth passed trivially and was tightened with a length assertion)
- [x] S3a.6 GREEN `src/ledger/project.js` (registry + loan projector), `rows.js` (working rows, payment application, balance, statuses), `tail.js` (plan-changing handlers); `buildSchedule` option `installmentMinor`
- [x] S3a.7 RED `test/ledger/commit.test.js` (suite failed: `commit.js` missing)
- [x] S3a.8 GREEN `src/ledger/commit.js` (`planCommit`, `commitPlan`) and `CommitError` in `errors.js`
- [x] S3a.9 REFACTOR and size checkpoint: barrel exports (`EVENT_KINDS`, `activeEvents`, `sortEvents`, `validateEvent`, `allocate`, `project`, `registerProjector`, `planCommit`, `commitPlan`, `CommitError`), exact-keys test and source list updated RED-first in each commit, `npm test`, `npm run build`; size over the ceiling, split into four commits/PRs as above

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| S3a.1/S3a.2 | `packages/finance-core/test/ledger/events.test.js` | Unit (node env) | Core suite 155/155 before touching `terms.js` and the barrel | Written first; suite failed to import `events.js` | 11/11 passed | Nine kinds, every payload shape, 11 rejection codes, bank split sum/bucket/key errors, sort order (same day by createdAt then id), 200 seeded shuffles, void of a missing event and void of a void | None needed; barrel RED first (exact-keys test failed) |
| S3a.3/S3a.4 | `test/ledger/allocate.test.js` | Unit + seeded property (200 cases) | N/A (new) | Written first; suite failed to import `allocate.js` | 12/12 passed | Spec short payment (10,000 / 90,000 / 0, remaining 90,876 + 199,505), exact payment, surplus, taxes and late-interest order, zero amount, custom order (partial lists, appended buckets), invalid orders, bank-split override with cap and carry, property: total + surplus = amount, bucket <= due, earlier buckets fill first (more than 10 surplus cases and more than 10 partial cases asserted) | None needed |
| S3a.5/S3a.6 (core) | `test/ledger/project.test.js` | Unit + seeded property | Core suite 178/178 | Written first; suite failed to import `project.js` | 22/22 passed first run; 2 mutations (no capitalization rule, no `partial` status) failed 1 and 3 tests, then reverted | Five statuses across two scenarios, due-on-asOf boundary, future-dated events ignored, short payment with fee + IVA (88,100 interest), spill into the next row, exact payment, custom order, bank split with carry, surplus, total grace (balance only grows once a period passes; fee-only grace row), balance-only family loan (never below 0), 200 void-restores cases (more than 150 verified to change state), 25 shuffles with same-day events, termsJson input, invalid asOf/events/debt, registry dispatch and removal | Payment helpers split into `rows.js`; barrel RED first |
| S3a.5/S3a.6 (plan changes) | `test/ledger/project.terms.test.js`, `test/schedule.french.test.js` (+5) | Unit + seeded property (200 cases) | Core suite 205/205 | Written first; 27 of 28 failed (handlers missing), then 16 after wiring, then 3 after the tail logic; 4 of 5 schedule tests failed first | 28/28 and 21/21 passed; 3 mutations (touched-prefix rule, refinanced arrears, keep-installment) failed 2-8 tests each, then reverted | Spec 0% examples (reduce term: 8 left at 100,000; reduce installment: 11 left at 72,727 + residue; advance), non-multiple extra, extra covering the due installment first, cap at balance with surplus, balance-only; 24% EA with 12 paid + 2,000,000 (term vs installment vs advance interest ordering), rate change keep term (cross-checked with `buildSchedule`) / keep installment lower and higher (past original term) / paid-ahead rows untouched / after the last installment, charge change (replace, empty, paid-ahead), restructure (arrears carried, later events on the new plan, advance-paid rows dropped, into balance-only), adjustment (+/- drift, no-op, no balance, balance-only, unabsorbable), property: well-formed plans, allocation totals, determinism, void of the last change restores | `buildSchedule` shares `MAX_PERIODS`; `addCharges` exported for charge changes |
| S3a.7/S3a.8 | `test/ledger/commit.test.js` | Unit (fake port) | Core suite 233/233 | Written first; suite failed to import `commit.js` | 20/20 passed first run; 3 mutations (no 404 tolerance, no id remap, no 409 tolerance on the row) failed 1-2 tests each, then reverted | Cost 190,876 = charges + interest on the 10,000 / 180,876 / 199,505 split, row id `dc{eventId}`, fields and ownerScope, taxes included, zero cost -> `costRow:null`, bank split cost, extra payment without cost, void plan (`void:{target}`, delete `dc{target}`), invalid void targets, context and draft validation, oversized payload, retry (no second event or row), 409 on the row, row failure then completion, foreign event id for the dedupe key, non-409 event errors, void delete failure then completion | None needed; barrel RED first |

Test summary: 98 tests written (11 + 12 + 22 + 28 + 20 + 5), 98 passing; core suite 14 files / 253 tests; full suite 46 files / 467 tests passing (S2 baseline 41 files / 369; the first full run showed 2 unrelated jsdom timeouts under load, the rerun was clean 467/467, the same pre-existing flakiness as earlier batches). Pure functions created: `validateEvent`, `sortEvents`, `activeEvents`, `allocate`, `allocateSplit`, `project`, `registerProjector`, `planCommit`, `commitPlan` (async, over an injected port), plus the internal `payRows`, `paySplit`, `payBalanceOnly`, `balanceAt`, `decorate`, `tailStart`, `applyExtra`, `applyRateChange`, `applyChargeChange`, `applyRestructure`, `applyAdjustment`.

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test | `npx vitest run packages/finance-core/test/ledger`: exit 0, 5 files, 93 tests passed (`npx vitest run packages/finance-core`: 14 files, 253 tests) |
| Runtime harness | N/A: pure core with a fake port (the in-memory fake enforces a unique `dedupeKey` and unique row ids and fails on demand); the seeded property tests (200 void cases, 200 plan-change cases, 200 allocation cases) are the harness. `npm test` exit 0 (46 files, 467 tests); `npm run build` exit 0 |
| Rollback boundary | Delete `packages/finance-core/src/ledger/` and `test/ledger/`, the S3a exports in `index.js` and `CommitError` in `errors.js`, the `installmentMinor` option (`schedule/index.js`, `schedule/french.js`) with its 5 tests, the `export` keywords added to `normalizeCharges`, `MAX_PERIODS` and `addCharges`, and the S3a entries of the barrel/source lists in `test/node16.test.js` (nothing outside `packages/finance-core/` imports them yet) |

### Deviations and decisions
- **Size over the work-unit ceiling**: 2,233 changed lines against the owner ceiling of 2,000 (forecast 760). Every proposed PR is at most 697 lines. Pending decision: accept, or trim tests.
- **Late interest accrual is not implemented in `project()`.** The `lateInterest` bucket exists end to end (`allocate`, `allocateSplit`, bank splits, cost = charges + taxes + lateInterest + interest, `totals.lateInterestPaid`), but `terms.lateRate` is not turned into accrued late interest: no spec scenario or S3a task requires it, and a correct accrual (per day, per overdue row, across partial payments) would have added about 150 lines. Late interest only appears when the bank states it in `bankSplit.lateInterest`.
- **Event shape.** `validateEvent` accepts stored rows (`$id`, `$createdAt`, `payloadJson`) or normalized ones and returns `{ id, debtId, kind, effectiveOn, amountMinor, payload, createdAt, actorId, source, dedupeKey }`. `payment`, `extra_payment`, `disbursement` and `charge` need `amountMinor > 0`; the other kinds need 0. A `bankSplit` must add up to the amount (`invalid_bank_split`) and accepts the five buckets (the design lists three).
- **Void semantics**: a void targeting a missing event or another void has no effect (voids cannot be undone); events and voids dated after `asOf` are ignored, so a future-dated void does not hide a payment yet. `sortEvents` and `activeEvents` return normalized copies; ties are broken by id so any storage order projects identically.
- **Extra payment**: it first pays what is already due (installments due on or before its date, oldest first); only the rest is extra principal, rebuilt from the first installment that is due after the date and has no payment on it or after it. `reduce_term` keeps the French level installment (new `buildSchedule` option `installmentMinor`; the calendar continues past `n` if needed) and `reduce_installment` keeps the remaining count. For German, bullet, interest-only and manual plans both strategies keep the term (the schedule is rebuilt on the lower balance); manual plans drop rows that have nothing left. `advance_installments` is a plain cascade over the oldest open rows.
- **Plan changes** (`rate_change`, `charge_change`, extras, adjustments) rewrite only the tail that starts at the first installment due after the effective date and after every installment that already has a payment; a partially paid installment keeps its old figures. `keep_installment` is French-only (other systems keep the term) and throws `installment_too_low` if the installment cannot cover the new interest.
- **Restructure**: installments due on or before the date stay as history; what they still owed is refinanced (`refinancedMinor`, status `paid`, outstanding 0) and the unpaid interest and charges are capitalized into the carried balance together with the principal. Installments after the date are dropped, including ones paid in advance (their payments stay in `applied` and in the balance). The new rows continue the period numbering; `termsVersion` is `debt.termsVersion ?? 1` plus one per replayed restructure. A restructure into `system:'none'` becomes a balance-only debt.
- **Adjustment**: the stated `balanceMinor` is the truth; `applied[].driftMinor` records stated minus computed, a `drift` notice carries `absorbed`, and the difference is absorbed by rebuilding the following installments over the same number of periods (balance-only debts just take the stated balance). With no installment left to rebuild the drift is reported with `absorbed:false`.
- **A prepayment that clears the debt** removes the tail; the last kept row keeps its scheduled closing balance (history is not rewritten), so "last closing is 0" holds only while a balance remains.
- **Projection additions** beyond the design: `terms` (terms in force), `remainingPeriods`, `notices` (`surplus`, `drift`), `applied[].extraPrincipalMinor` / `driftMinor`, `totals.lateInterestPaid`, row `refinancedMinor`. `applied` holds one entry per active event (non-payment kinds have `allocation: null`). `nextDue` is the first row that is `pastDue`, `partial` or `due`. A row with nothing to pay (a total-grace row without charges) is `paid` once its date passes and `future` before.
- **Commit shapes**: event and cost rows are `{ id, data }`; the cost row's `occurredAt` is `${effectiveOn}T12:00:00.000Z` (deterministic, so web and Nia write the same value; still the same day in Colombia). `planCommit` also returns `costMinor`, `allocation`, `deleteCostRowId` and `projection` (state right after the event, for previews). The draft is flat: `{ kind, effectiveOn, amountMinor?, ...payload }`; the caller supplies `ctx.eventId`, `dedupeKey`, `actorId`, `source` (a void derives `void:{target}`).
- **`commitPlan` order**: `ensureCostCategory` runs before the event write (the design's diagram lists it last, but the row needs the category id), and only when there is a cost row. A failure after the event throws `CommitError` (`partial: true`, `eventId`); rerunning the plan completes it. If another client already stored the event for that `dedupeKey`, the cost row follows the stored event's id. `port.atomic` is not used yet (S4.8-S4.9).
- New internal files not in the design table: `ledger/rows.js` and `ledger/tail.js` (keep `project.js` readable). `terms.js` now exports `normalizeCharges` and `MAX_PERIODS`; `schedule/index.js` exports `addCharges`; none of them is in the barrel.

### Notes
- The projector registry accepts any kind; S7 will register `card`. The loan projector is used for every other kind.
- Git warns about LF-to-CRLF conversion on every add (autocrlf); blobs are normalized, nothing to do.

## Batch 6: S3b (prepayment simulation, comparison, advice, facts) - COMPLETE

Branch `feat/debt-s3b-advice` (stacked on `feat/debt-s3a4-commit`). Three work-unit commits, each green on its own (tests + implementation + barrel together):
- `3779010 feat(finance-core): simulate and compare prepayment strategies` (353 lines)
- `f643b86 feat(finance-core): add deterministic prepayment advice with Ley 1555 notice` (239 lines)
- `e5d5a21 feat(finance-core): add structured advice facts and deterministic summary` (240 lines: 238 added / 2 deleted)

Size: 830 changed lines summed over the three commits (828 net against the S3a head, 11 files: src about 316, tests about 480, barrel and test helper about 32). The forecast was 600 and the owner ceiling is 2,000, so the unit is well inside it. The whole unit is about 30 lines over one 800-line PR, so the proposed grouping is two stacked PRs:

| PR sub-branch (proposed) | Commits | Lines |
|---|---|---|
| `feat/debt-s3b1-prepay-simulation` | `3779010` | 353 |
| `feat/debt-s3b2-advice` | `f643b86`, `e5d5a21` | 479 |

### Tasks
- [x] S3b.1 RED `test/prepay/simulate.test.js`, `compare.test.js` (suites failed: modules missing)
- [x] S3b.2 GREEN `src/prepay/simulate.js` (`simulateExtra`), `compare.js` (`compareStrategies`)
- [x] S3b.3 RED `test/advice/advice.test.js`, `facts.test.js` (suites failed: modules missing)
- [x] S3b.4 GREEN `src/advice/advice.js` (`ADVICE_DEFAULTS`, `advise`), `facts.js` (`buildFacts`, `renderSummary`)
- [x] S3b.5 REFACTOR and size checkpoint: barrel exports (`simulateExtra`, `compareStrategies`, `ADVICE_DEFAULTS`, `advise`, `buildFacts`, `renderSummary`), exact-keys test and source list updated RED-first in each commit, `npm test`, `npm run build`

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| S3b.1/S3b.2 (simulate) | `packages/finance-core/test/prepay/simulate.test.js` (+ `test/helpers/loans.js`) | Unit (node env) | Core suite 253/253 before touching the barrel | Written first; suite failed to import `simulate.js` | 11/11 passed | Spec 0% fixture under the three strategies (8 x 100,000; 11 x 72,727; advance), French 10M/24%/36 after 12 payments with +2,000,000 (term shrinks and installment holds; term stays and installment drops; term saves more than installment, advance 0; remaining interest drops by exactly the saving), charges/taxes savings with a `pctOutstanding` insurance, payoff cap for each strategy (applied 1,100,000, surplus 3,900,000, balance 0), frozen inputs, penalty 2% vs default 0 with identical savings, 4 validation errors | None needed |
| S3b.1/S3b.2 (compare) | `test/prepay/compare.test.js` | Unit + seeded property (200 cases) | Core suite 264/264 | Written first; suite failed to import `compare.js` | 5/5 passed | French fixture, 0% (equal savings, different shape), German (identical plus `strategies_identical` note), frozen inputs, 200 seeded French loans (10% at 0%): reduce_term saved >= reduce_installment >= 0, advance exactly 0, balance after = before - extra, more than 150 cases with positive savings | Barrel RED first (exact-keys test failed), then exports |
| S3b.3/S3b.4 (advice) | `test/advice/advice.test.js` | Unit (truth table) | Core suite 269/269 | Written first; suite failed to import `advice.js` | 15/15 passed (2 failures were a fixture error: a 2M extra on the 1.1M family loan is a payoff, so the strategies were identical; fixed the test, not the code) | Default, tight margin (cites margin), installment ratio (cites ratio), card 35% vs loan 18% (avalanche names the card), 0% (liquidity, no savings claim), 0% plus higher-rate debt (still a reason), tight plus higher-rate (liquidity wins, debt listed), unknown cash flow, identical strategies, gap 0 means strictly higher (equal EA vs +0.01), configurable gap/margin/ratio incl. exactly-at-threshold, invalid thresholds, Ley 1555 (mortgage: notice with asOf, simulation untouched; consumer: none) | Barrel RED first |
| S3b.3/S3b.4 (facts) | `test/advice/facts.test.js` | Unit | Core suite 284/284 | Written first; suite failed to import `facts.js` | 17/17 passed after fixing 3 test/wording issues (wrong EA literal in my fixture, wrong key name, and the 0% sentence contained "saved") | Raw numbers and pre-formatted text, one reason code per signal in 5 scenarios, target debt and rate, notice outside the numbers, determinism and frozen input, completeness check across 8 scenarios (every number token of the summary exists in facts; a negative control proves the check can fail), verdict wording, 0% claims no savings, payoff and penalty lines only when they apply | `advise` attaches `facts`; barrel RED first |

Test summary: 48 tests written (11 + 5 + 15 + 17), 48 passing; core suite 18 files / 300 tests; full suite 50 files / 514 tests passing (S3a baseline 46 files / 467). The first full run showed 2 unrelated jsdom timeouts under load, the rerun was clean 514/514 (the same pre-existing flakiness as earlier batches). Pure functions created: 5 public (`simulateExtra`, `compareStrategies`, `advise`, `buildFacts`, `renderSummary`) plus the internal `snapshot`, `evaluateSignals`, `signalReasons`, `decide`, `figures`, `reasonLine`, `strategyLines`.

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test | `npx vitest run packages/finance-core/test/prepay packages/finance-core/test/advice`: exit 0, 4 files, 48 tests passed (`npx vitest run packages/finance-core`: 18 files, 300 tests) |
| Runtime harness | N/A: pure functions with no runtime boundary; the spec fixtures (0% 1,200,000 x 12 and French 10M at 24% EA) and the 200-case seeded property are the harness. `npm test` exit 0 (50 files, 514 tests); `npm run build` exit 0 |
| Rollback boundary | Delete `packages/finance-core/src/prepay/`, `src/advice/`, `test/prepay/`, `test/advice/`, `test/helpers/loans.js`, the six S3b exports in `index.js` and the S3b entries of the barrel/source lists in `test/node16.test.js` (nothing outside `packages/finance-core/` imports them yet) |

### Deviations and decisions
- **Raw signals, not booleans, go into `advise`.** Design: `advise(comparison, signals, thresholds)` with `cashflowSignals` (S9) producing `tightMargin`/`higherRateDebt`. Here `advise` takes raw figures (`{avgIncomeMinor, avgExpenseMinor, installmentMinor?, otherDebts: [{id, name, eaPercent}]}`) and applies the thresholds itself, so the rules (tight margin by ratio or by installment-to-income, strictly-higher EA with the gap) live in one tested place. `installmentMinor` defaults to the installment before the extra. Consequence for S9: `cashflowSignals` only needs to produce those averages and the other debts; the derived booleans are in `advice.signals`. Thresholds: `ADVICE_DEFAULTS` `{tightMarginRatio: 0.10, maxInstallmentToIncome: 0.30, higherRateGapPct: 0}`, overridable per call and validated (`invalid_thresholds`).
- **Boundaries are strict**: margin exactly at the threshold is not tight; installment ratio exactly at the maximum is not tight; an EA equal to this debt's (gap 0) is not "higher". Unknown averages give `tightMargin: null` (treated as not tight, reason `cashflow_unknown`); known income of 0 with a positive installment is tight (installment ratio).
- **Simulation semantics.** `simulateExtra(debt, events, {amountMinor, strategy, on})` replays `project()` at `on` with and without a hypothetical `extra_payment` (id `simulation:extra`, `createdAt` `9999-12-31T23:59:59.999Z` so it sorts last on its day). Savings are lifetime (paid + remaining) interest and charges+taxes, so the installments the extra pays first (already due) do not inflate the saving. `before`/`after` snapshots: balance, remaining periods, next installment still to pay (principal + interest, first open row due after `on`) with its date, last due date, remaining interest, remaining charges+taxes. Extra fields: `appliedMinor`, `extraPrincipalMinor`, `surplusMinor`, `paidOff`, `eaPercent`, `kind`, `system`, `penaltyPct`, `penaltyMinor` (penalty = pct of the extra principal, of the applied amount for advance; informational, savings are not reduced by it).
- **`compareStrategies` result**: `{on, amountMinor, kind, system, eaPercent, reduceTerm, reduceInstallment, advance, identical, notes}`. For non-French systems (and for a full payoff) both reduce strategies come out the same: `identical: true` and a `strategies_identical` note, surfaced as a reason code by `advise`, so no UI presents two fake options. 0% French loans are not identical (different term and installment) but both save 0.
- **Verdicts**: `reduce_term`, `reduce_installment`, `avalanche` (with `targetDebt` = highest-EA debt above this one), `liquidity_only` (`claimsSavings: false`). Reasons: `default`, `zero_rate`, `tight_margin`, `installment_ratio`, `higher_rate_debt`, `cashflow_unknown`, `strategies_identical`, each carrying the numbers behind it. Precedence exactly as designed (0% > tight margin > higher-rate debt > default); with both 2 and 3 true the verdict is `reduce_installment` and `higher_rate_debt` stays in `reasons`.
- **Facts shape**: `{asOf, verdict, claimsSavings, identical, paidOff, reasonCodes, targetDebt, higherRateDebt, numbers, text, notices}`. `numbers` and `text` are flat maps with the same keys (for example `reduceTerm.interestSaved`); money text uses `.` as thousands separator (`2.000.000`), percentages up to 2 decimals (`28.32%`), shares of income as percent. Dates only exist as text. The Ley 1555 notice is carried in `notices` (code, asOf, message) and is not part of the numbers; its message contains "Ley 1555", which S9's number guard must allow (or strip) when it scans a paraphrase.
- **`renderSummary(facts)`** (not in the design file table): a deterministic English summary built only from `facts` values; it is how "every number the rendered summary shows is in facts" is made testable in S3b. Nia and the web can localise by reusing the same values; it is also a valid fallback template.
- **`advise` attaches `facts`** (spec: advice returns `facts`). `buildFacts(advice)` is also exported and accepts the advice without the `facts` field.
- Test helper `test/helpers/loans.js` (compact fixtures: `french`, `interestFree`, `debt`, `ev`, `onTime`, `deepFreeze`) is shared by the S3b tests; the older S3a tests keep their own inline helpers (not refactored).
- Language: code, comments, tests and the summary text are English; no `Object.hasOwn`, array `.at(`, `findLast`, `toSorted`, `structuredClone` or `groupBy` (the node16 scan covers the new files).

### Notes
- Git warns about LF-to-CRLF conversion on every add (autocrlf); blobs are normalized, nothing to do.
- Pre-existing jsdom flakiness persists under load (first full run: 2 timeouts; rerun: 514/514).

## Batch 7: S4 (schema, data layer, alias) - COMPLETE except owner-gated items (OA-2, OA-3)

Branch `feat/debt-s4-schema-data` (stacked on `feat/debt-s3b2-advice`). Three work-unit commits, each green on its own (tests + implementation + docs together):
- `060a61e feat(appwrite): add additive debt schema to the migration script` (299 lines: 297 added / 2 deleted; includes the `docs/setup.md` update)
- `a0a5978 feat(web): add @finance-core alias for the debt core` (53 lines)
- `b9cc35f feat(web): add debt data layer and commitPlan port to the Appwrite client` (476 lines)

Size: 828 changed lines summed over the three commits (826 added / 2 deleted, 8 files: `src/appwrite.js` 140, `vite.config.js` 5, `debt-schema.mjs` 85 plus migrate edits, tests 580, docs 16). The forecast was about 450 and the owner ceiling is 2,000, so the unit is well inside it. It is about 28 lines over one 800-line PR, so two stacked PRs are proposed:

| PR sub-branch (proposed) | Commits | Lines |
|---|---|---|
| `feat/debt-s4a-schema-alias` | `060a61e`, `a0a5978` | 352 |
| `feat/debt-s4b-data-layer` | `b9cc35f` | 476 |

No live Appwrite access of any kind happened: `npm run migrate:appwrite` and `scripts/migrate-appwrite.mjs` were never executed (only `node --check` for syntax and static source reads in tests), the spike script was never run, no network calls, `.env` never read.

### Tasks
- [x] S4.1 Spike prep: SDK method availability confirmed by reading `node_modules/appwrite/types/services/tables-db.d.ts` (appwrite 26.2.0): `TablesDB.createTransaction({ttl})`, `getTransaction`, `updateTransaction({transactionId, commit, rollback})`, `deleteTransaction`, `createOperations({transactionId, operations})`, and `transactionId` on `createRow`/`getRow`/`listRows`. `scripts/spike-transactions.mjs` written (REST with an API key, because the web SDK `Client` has no `setKey`), checked with `node --check` only. It is **untracked and not committed** (stays local for the owner). Safety: it refuses to run unless `SPIKE_DATABASE_ID` starts with `scratch`, differs from `VITE_APPWRITE_DATABASE_ID`/`finanzas_plus`, and `SPIKE_CONFIRM_SCRATCH=yes` is set; all connection settings are explicit `SPIKE_*` variables. It checks: commit of two creates, a duplicate unique key rejecting the whole commit, no partial row after the rollback, and row-level team read permission on a committed row. It prints PASS / FAIL / INCONCLUSIVE.
- [ ] S4.2 **PENDING owner action OA-2** (not run). **Decision recorded: the sequential idempotent fallback is adopted for now** (unique `dedupeKey` on `debt_events`, deterministic cost-row id `dc{eventId}`, 409 = already done, reconcile on read). S5+ are not blocked. If the owner later runs the spike and records PASS in `openspec/changes/debt-management/spike-transactions.md`, S4.8-S4.9 can be implemented in a follow-up.
- [x] S4.3 RED `scripts/lib/debt-schema.test.js` (suite failed: `debt-schema.mjs` missing)
- [x] S4.4 GREEN `scripts/lib/debt-schema.mjs` (`DEBT_TABLES`, `TRANSACTIONS_DEBT_PATCH`, `withDebtSchema`); `scripts/migrate-appwrite.mjs` renames its literal list to `baseTables` and builds `tables = withDebtSchema(baseTables, team)`; the create-only `ensure*` loops are untouched
- [x] S4.5 RED `src/appwrite.test.js` (24 new tests; all 24 failed first: functions missing; the 10 existing tests stayed green)
- [x] S4.6 GREEN `src/appwrite.js` additions: `TABLES.debts/debtEvents`, `permissions.debtRow/debtEventRow/costRow`, `listDebts`, `listDebtEvents(debtId?)`, `createDebt`, `createDebtEvent`, `findDebtEventByDedupe`, `createCostRow`, `updateCostRow`, `deleteCostRow`, `listCostRows`, `ensureCostCategory`, `debtPort()`
- [x] S4.7 RED then GREEN `src/test/financeCoreAlias.test.js` (suite failed to resolve `@finance-core`), then the `vite.config.js` alias
- [ ] S4.8 SKIPPED: fallback adopted pending OA-2
- [ ] S4.9 SKIPPED: fallback adopted pending OA-2
- [x] S4.10 Docs (neutral Spanish) in `docs/setup.md` section 3: table count updated (eleven) and a new subsection "Actualizar una base existente (gestión de deudas)": additive change, re-run `npm run migrate:appwrite` before deploying S4 or later, try it twice on a dev database first, the second run creates nothing, tables may stay unused on rollback. Matches OA-3.
- [x] S4.11 REFACTOR and verify: `npm test`, `npm run build`, size checkpoint (see above)

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| S4.3/S4.4 | `scripts/lib/debt-schema.test.js` | Unit + static source checks (node env; `node --check` of the migrate script via `execFileSync`, never executed) | `scripts/` suite 23/23 before touching `migrate-appwrite.mjs` (it has no tests of its own) | Written first; suite failed to import `debt-schema.mjs` | 17/17 passed | Exact column shape (type, size, required) of both tables, both index sets incl. the unique `by_dedupe`, permissions as actions (events have no update/delete), index columns exist, size budgets, transactions patch, merge: appended tables with team-qualified permissions and original order, `debtId` merged into transactions with permissions untouched, input not mutated, second merge refused, collisions on column/index refused, missing `transactions` refused, migrate source imports the schema and keeps the create-only loops, no `DELETE`, new table ids absent from the script's own ids | None needed (the merge helper was written pure from the start so the script itself stays trivial) |
| S4.5/S4.6 | `src/appwrite.test.js` | Unit (`vi.mock('appwrite')`) + contract test against the real core | 10/10 existing tests before editing | Written first; 24/24 new tests failed (exports missing) | 34/34 passed first run | Debts/events list queries (with and without `debtId`), permissions per row type (debt read+update, event read only, cost row read+update+delete), id passthrough and generated ids differ, 409 surfaced and non-409 errors unchanged, `deleteCostRow` 404 vs 500, `findDebtEventByDedupe` hit and miss, category: folded-name hit (case, accents, spaces), create with `cf{householdId}` and exact data, 36-char cap, 409 re-read ok and 409 unexplained, other errors; `debtPort()` keys, plus `planCommit` then `commitPlan` over the mocked SDK: write order category, event, `dc{eventId}` with permissions, retry with both 409s returns the stored event and `duplicate: true`, void deletes `dcev1` and tolerates 404 | None needed |
| S4.7 | `src/test/financeCoreAlias.test.js` | Unit (node env) + config resolution | `src/appwrite.test.js` 10/10 | Written first; suite failed to resolve `@finance-core` | 4/4 passed | Barrel identity through alias vs relative path (same function object, same key list), real core code through the alias (`rateLabel`, a 12-row 0% schedule), `resolveConfig` shows the alias for build mode pointing at `packages/finance-core`, `.dockerignore` has no `packages` pattern. One-off proof outside the repo: a Vite lib build of a file importing `@finance-core` bundled the core | None needed |

Test summary: 45 tests written (17 + 24 + 4), 45 passing; full suite 52 files / 559 tests passing (S3b baseline 50 files / 514; the first full run showed 2 unrelated jsdom timeouts under load, the rerun was clean 559/559, the same pre-existing flakiness). Pure functions created: 1 (`withDebtSchema`) plus the `foldName` and `hasStatus` helpers.

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test | `npx vitest run scripts/lib/debt-schema.test.js src/appwrite.test.js src/test/financeCoreAlias.test.js`: exit 0, 3 files, 55 tests passed (17 + 34 + 4) |
| Runtime harness | Owner-side (OA-3, not run here by rule): `npm run migrate:appwrite` twice on a dev database, the second run must create nothing. Local stand-ins: `node --check scripts/migrate-appwrite.mjs` ok; the schema merge is exercised on fixtures; the real `planCommit` then `commitPlan` flow runs over the mocked SDK; a Vite build resolved the alias. `npm test` exit 0 (52 files, 559 tests, second run); `npm run build` exit 0 (built in 3.3s) |
| Rollback boundary | Revert the three commits: delete `scripts/lib/debt-schema.mjs` and its test, revert `scripts/migrate-appwrite.mjs` (import, `baseTables` rename, `withDebtSchema` call), the `docs/setup.md` additions, the `vite.config.js` alias, `src/test/financeCoreAlias.test.js`, the debt block appended to `src/appwrite.js` plus the `TABLES`/`permissions` entries, and the new tests in `src/appwrite.test.js`. Appwrite tables already created by OA-3 may stay unused. |

### Deviations and decisions
- **`withDebtSchema` instead of bare data.** The task says `debt-schema.mjs` is plain data. It exports plain data (`DEBT_TABLES`, `TRANSACTIONS_DEBT_PATCH`) plus one small pure helper, `withDebtSchema(tables, team)`, so the merge (append tables, qualify permissions, extend `transactions`, refuse collisions) is unit-tested without importing `migrate-appwrite.mjs` (it runs on import and calls `process.exit`). The helper has no dependency on migrate's own helper functions.
- **Table permissions are bare actions in the schema** (`['read','create','update']`); the script qualifies them with the household team. Index `orders` are `[]`, as for the script's existing unordered indexes.
- **`ensureCostCategory` id** is `cf{householdId}` cut to 36 characters (Appwrite's id limit), so a long household id still yields a valid, deterministic id. Color `#7A5AF8` (palette purple), icon `receipt` (an existing key), kind `need`; hardcoded in `appwrite.js` to avoid importing `lucide-react` through `shared/lib/categories.js`.
- **Event and cost-row functions take `{ id, data }`** (the shape `planCommit` produces) and return the stored row, so `debtPort()` is a direct match for `commitPlan` with no adapter. `createDebt` takes the same shape (id optional, falls back to `ID.unique()`).
- **No ordering queries** on `listDebts`/`listDebtEvents`: `project()` sorts events itself and cursor pagination over a non-unique ordering is avoided. `findDebtEventByDedupe` also filters by `householdId`.
- **`updateCostRow`/`deleteCostRow`** delegate to the existing `updateTransaction`/`deleteTransaction`; the new row permissions come from `permissions.costRow` (team read, update, delete), one more key on the exported `permissions` object (additive; existing keys unchanged).
- **Spike over REST.** The web SDK `Client` cannot carry an API key, so the spike script calls the same Transactions endpoints (`/tablesdb/transactions`, `/operations`, PATCH `commit`) with `X-Appwrite-Key`; the SDK surface was confirmed from the type definitions only. Endpoint shapes are unverified against a live server, which is what the spike is for (a wrong path would surface as INCONCLUSIVE, not as a false PASS).
- **Alias** maps `@finance-core` to the directory `packages/finance-core` (the bare import resolves its `index.js`; deep imports like `@finance-core/src/x.js` also work). Nia keeps using relative imports (AD3).
- S4.2, S4.8 and S4.9 stay unchecked in `tasks.md` on purpose (owner action pending / skipped), so S4 is code-complete but not "all boxes ticked".

### Notes
- Git warns about LF-to-CRLF conversion on every add (autocrlf); blobs are normalized, nothing to do.
- Owner actions: OA-2 (run the spike on a scratch database, record the result) and OA-3 (run the migration twice on a dev database, then on live, before deploying S5+) remain open.

## Batch 8: S5 (web navigation, list, loan wizard) - COMPLETE

Branch `feat/debt-s5-web-list-wizard` (stacked on `feat/debt-s4b-data-layer`). Seven commits, each green on its own (tests with code):
- `c67824b feat(debts): add debt list view model and data hook` (232)
- `a83aaec feat(debts): add the debts list with totals, empty and error states` (329)
- `7bbf7f6 feat(shell): add the Deudas section to navigation without the period switcher` (88)
- `19326ee feat(debts): add the loan wizard model with terms building and validation` (349)
- `22fa3c9 feat(debts): add the loan creation wizard with live rate echo and charges` (594)
- `90b7789 feat(debts): create loans from the wizard with idempotent writes and retry` (252)
- `74d204c fix(debts): keep wizard inputs when the same kind is picked again` (9)

Size: 1,811 changed lines in code and tests (1,805 added / 6 deleted, 34 files; tests are 864 of them), plus about 75 lines of this note and the task ticks. The forecast was 760; the owner ceiling for the work unit is 2,000. Because the unit exceeds one PR, four stacked PR branches of at most 800 lines are proposed (commits stay consecutive):

| PR sub-branch (proposed) | Commits | Lines |
|---|---|---|
| `feat/debt-s5a-list-nav` | `c67824b`, `a83aaec`, `7bbf7f6` | 649 |
| `feat/debt-s5b-wizard-model` | `19326ee` | 349 |
| `feat/debt-s5c-wizard-ui` | `22fa3c9` | 594 |
| `feat/debt-s5d-create-flow` | `90b7789`, `74d204c` | 261 |

(S5b+S5c would be 943, which is why they are not merged; S5c+S5d would be 855.) No live Appwrite access of any kind: every test mocks `src/appwrite.js`; no dev server was started.

### Tasks
- [x] S5.1/S5.2 `debtViewModel.js` (`buildDebtList`: projection per debt, totals, scope filter, archived hidden, unreadable debts flagged and kept out of the totals)
- [x] S5.3/S5.4 `useDebtData.js` (`loading -> ready | error`, `retry`, `reload`, newest request wins)
- [x] S5.5/S5.6 `DebtsView.jsx`, `DebtCard.jsx`, `DebtsContainer.jsx`, `debtLabels.js`
- [x] S5.7/S5.8 `wizard/wizardModel.js` (reducer, steps per kind, presets, `toTerms`, `evaluate`, `rateEcho`)
- [x] S5.9/S5.10 `RateField.jsx`, `wizard/DebtWizard.jsx`, `wizard/Notices.jsx`, `wizard/steps/{Kind,Basics,Rate,Plan,Charges,Review}Step.jsx`, `saveLoan.js`
- [x] S5.11/S5.12 nav: `navItems.js`, `MoreSheet.jsx`, `Topbar.jsx`/`MobileTopBar.jsx`/`AppShell.jsx` (`showPeriod`), `FinanceShell.jsx` (lazy `DebtsContainer`, `UNSCOPED_VIEWS`)
- [x] S5.13 REFACTOR and verify: `npm test` (58 files, 624 tests), `npm run build`, size checkpoint (above)

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| S5.1/S5.2 | `src/features/debts/debtViewModel.test.js` | Unit (pure, real core) | N/A (new) | Written first; suite failed to import `debtViewModel` | 6/6 | Two zero-rate loans with different dates; a recorded payment changes balance, next due and progress; 0% vs 2.1% MV (EA 28.32); scope filter, archived, events older than the month; unreadable terms; `system:'none'` | Renamed internal `describe` to `describeDebt` |
| S5.3/S5.4 | `useDebtData.test.jsx` | Hook (jsdom, mocked appwrite) | N/A (new) | Written first; import failed | 5/5 | loading to ready; failure with empty rows then retry; reload keeps status `ready` (no flicker); failed reload becomes `error` with no stale rows; a slow older response is ignored | None needed |
| S5.5/S5.6 | `DebtsView.test.jsx`, `DebtsContainer.test.jsx` (list part) | Component (RTL) | N/A (new) | Written first; import failed | 9/9 and 2/2 | Two debts with distinct figures; overdue chip and 0% label; totals equal the sum; empty state action; header action; no create action without `onAdd`; unreadable card; loading status; error panel with Reintentar and no totals or cards; container: scope filter, failure and retry | None needed |
| S5.7/S5.8 | `wizard/wizardModel.test.js` | Unit (pure, real core) | N/A (new) | Written first; import failed | 22/22 (1 fix to my own test: an IVA charge dispatched before its fee is correctly ignored) | Steps and defaults for consumer/vehicle/family/informal/leasing/other; navigation limits; terms for 25.2% NAMV, German with principal grace, leasing balloon, family manual plan, informal `none`, ordered presets (life, fee, IVA on fee, GMF 0.4); IVA needs its fee; 5 invalid cases on the right step plus the manual-plan-below-interest message; MV and NAMV echo, custom label, usury only for the capped modality, invalid rate | Message table `CORE_ISSUES`; same-kind guard added RED-first in `74d204c` |
| S5.9/S5.10 | `wizard/DebtWizard.test.jsx` | Component (RTL + user-event) | N/A (new) | Written first; import failed | 10/10 after 2 fixes (a core error was hidden behind a missing-field issue, so `evaluate` changed; the saving test now saves first) | 2.1% MV and 25.2% NAMV both echo 28.32% EA, custom convention; usury warning keeps Siguiente and Guardar enabled; anticipated 100% blocks with a message; negative principal; 0% French shows the first installment ($ 100.000) and zero interest before saving, then submits; failed save keeps the dialog with Reintentar and resubmits the same draft; no double submit; leasing balloon vs mortgage German; manual plan rows; charge presets with IVA gated by the fee | `missing` flag so empty required fields disable Siguiente without an alert |
| S5.9 (writes) | `DebtsContainer.test.jsx` (create flow) | Component with a mocked port | list tests 2/2 | Written first; 5/5 failed (no create action) | 7/7 | Event `de{nonce}` / dedupe `web:{nonce}:disb` and debt `db{nonce}` with exact data, no cost row and no category call, list reloaded and `onRefresh` called once; scope mapping with the other member signed in; failed save keeps the dialog, message, toast and the unchanged list, then the retry (event 409 -> lookup) reuses the same ids and nonce; debt 409 counts as saved; an edited draft after a failure gets a new nonce | None needed |
| S5.11/S5.12 | `Sidebar.test.jsx`, `MobileTabBar.test.jsx`, `Topbar.test.jsx`, `MobileTopBar.test.jsx`, `App.test.jsx` | Component + App integration | shell and app suites 70/70 before editing | Written first; 5/5 failed | 75/75, then the App creation test (RED: timed out because the shell did not pass `householdId`/`user`) 6/6 | Sidebar item and active state; MoreSheet item (no new tab); period switcher hidden in both bars; App: lazy load on first visit, scope control filtering, no `Periodo` group in either bar, creation through the shell with `getWorkspace` refreshed | None needed |

Test summary: 65 tests written (59 under `src/features/debts`, 4 shell, 2 App); full suite 58 files / 624 tests passing (S4 baseline 52 files / 559). Pure functions created: `buildDebtList`, `wizardReducer`, `toTerms`, `evaluate`, `rateEcho`, `describeRate`, `conventionOf`, `firstDueOf`, `stepsFor`.

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test | `npx vitest run src/features/debts src/features/shell src/app`: exit 0, 14 files, 135 tests passed |
| Runtime harness | `npm test` exit 0 (58 files, 624 tests); `npm run build` exit 0 (`DebtsContainer` is its own lazy chunk, about 61 kB with the core). The manual `npm run dev` check (open Deudas, create a loan) was not run here by instruction (no dev server) and stays with the owner or the verify phase; the create flow runs against the mocked Appwrite port and the real `planCommit`/`commitPlan`/`serializeTerms` |
| Rollback boundary | Delete `src/features/debts/`; revert the Deudas entry in `navItems.js`/`MoreSheet.jsx`, the `showPeriod` prop in `Topbar.jsx`/`MobileTopBar.jsx`/`AppShell.jsx`, the lazy case plus `UNSCOPED_VIEWS` in `FinanceShell.jsx`, and the matching test additions. Debts already written to Appwrite stay (append-only). |

### Deviations and decisions
- **Data layer names.** S5.3 says the hook mocks `listAllRows`; it calls `listDebts()`/`listDebtEvents()` from S4 (which wrap `listAllRows`), and the tests mock those.
- **Container props.** `DebtsContainer` receives `inScope`, `currentOwnerScope`, `scopeControl`, `householdId`, `user`, `onRefresh`, `onNotify`. `categories` (listed in S5.11) is not passed: nothing in S5 reads it (the cost category is ensured by the port in S6).
- **Write order.** `saveLoan` writes the `disbursement` event first, then the debt row. An event without a debt is invisible; a debt without its event would be listed half-created. A 409 on the debt (same nonce, same draft) counts as saved. If the draft changed after a failed attempt, the container generates a new nonce instead of reusing the old ids (otherwise a retry would silently keep the old terms).
- **Spec wording "2.1% monthly nominal".** 2.1% is the periodic monthly rate (M.V.), which is the one that gives about 28.32% EA; 2.1% N.M.V. would be about 2.12% EA. The tests cover M.V. 2.1 and N.M.V. 25.2 (both 28.32%). The convention select offers EA, NAMV, MV, NATV, NATA, NAMA and a custom basis, periodicity and timing.
- **Validation UX.** Each step blocks "Siguiente" with an inline message for invalid input (negative principal, invalid anticipated rate, manual plan below the interest, bad grace, balloon or charges); empty required fields only disable the button. Review also disables saving while any issue exists. Because the steps are gated, the save button is unreachable while the data is invalid, which satisfies "save disabled with an inline message".
- **Rate label.** `rateLabel` is used for the named conventions; for a custom convention the wizard writes its own Spanish label (for example `6% nominal bimestral anticipada ≈ 6.2% EA`) because `rateLabel` uses English words.
- **Period switcher.** Topbar, MobileTopBar and AppShell gained an optional `showPeriod` prop (default true); only Deudas hides it. Metas keeps showing it (existing behavior, not touched).
- **Kinds.** Wizard kinds: consumer, vehicle, mortgage, libranza, leasing (interest-only with a balloon, or French), family (French at 0% by default, or manual), informal (`system:'none'`, no rate or plan steps), other (manual plan). Card is not offered (S7). Charge `display:'bundled'` is not exposed (default itemized); presets are life insurance (`pctOutstanding`), other insurance (fixed), fee (fixed), IVA on the fee (`pctOfCharge`, needs the fee) and GMF (`pctOfSubtotal` 0.4).
- **Usury and Ley 1555 notices** are informational (never block). The usury table still holds the single unverified entry from S1 (OA-5), so the warning says the cap is not officially verified.
- The topbar's "Nuevo movimiento" button and search remain visible on Deudas (unchanged shell behavior).

### Notes
- `useDebtData.reload` turns a failed reload into the error state (empty rows) instead of showing the pre-save list as confirmed.
- Owner actions still open: OA-2, OA-3 (the Deudas section needs the S4 tables on the live database before S5 is deployed), OA-5.

## Batch 9: S6 (debt detail, plan, payment, void, simulator, reconcile) - COMPLETE

Branch `feat/debt-s6-detail-payments` (stacked on `feat/debt-s5d-create-flow`). Six work-unit commits, each green on its own (tests with code):
- `4fe44ea feat(debts): reconcile a debt's cost rows against its events on read` (237)
- `a29c1d0 feat(debts): show the full payment plan with status chips, paging and phone cards` (219)
- `7ad7073 feat(debts): add the debt detail with real cost, event history and repair on open` (506)
- `935c7fc feat(debts): record payments and extra payments with a split preview and idempotent retry` (651)
- `b74fd3e feat(debts): void a payment with confirmation, restoring the balance and removing its expense` (121)
- `dac0a5d feat(debts): simulate extra payments with a deterministic recommendation and convert them to a payment` (403)

Size: 2,066 net changed lines in code and tests (2,049 added / 17 deleted across 36 files against the S5 head; 2,137 summed over the six commits because the container is touched in several of them), plus this note and the task ticks. The forecast was 760 and the owner ceiling is 2,000, so the unit is about 66 net lines (3%) over the ceiling. Every proposed PR is at most 800 lines; stacked grouping (commits stay consecutive):

| PR sub-branch (proposed) | Commits | Lines (net) |
|---|---|---|
| `feat/debt-s6a-reconcile-plan` | `4fe44ea`, `a29c1d0` | 456 |
| `feat/debt-s6b-detail` | `7ad7073` | 506 |
| `feat/debt-s6c-payment-void` | `935c7fc`, `b74fd3e` | 762 |
| `feat/debt-s6d-simulator` | `dac0a5d` | 403 |

(S6b+S6c would be 1,195; S6a+S6b 962; hence four PRs.) No live Appwrite access of any kind: every test mocks `src/appwrite.js` or injects the port; no dev server was started.

### Tasks
- [x] S6.1/S6.2 `reconcile.js` (`planReconcile`: create / update / delete by comparing `project()` costs with the debt's `dc{eventId}` rows) and `useDebtData.reconcileCosts(debtId)`; core gained one export, `buildCostRow` (the commit's own row builder), so a repair writes exactly what the commit would have
- [x] S6.3/S6.4 `PlanTable.jsx`, `debtDetailModel.js` (`buildDebtDetail`), `EventHistory.jsx`, `DebtDetail.jsx`; `DebtCard` opens the detail through its name button
- [x] S6.5/S6.6 `paymentModel.js` (`previewPayment`), `PaymentDialog.jsx`, `saveDebtEvent.js`, `useCommitDialog.js`, `DebtDetailContainer.jsx` (the detail's own container; `DebtsContainer` delegates to it)
- [x] S6.7/S6.8 `VoidDialog.jsx` and the void handler (same `useCommitDialog`)
- [x] S6.9/S6.10 `cashflow.js`, `prepaymentModel.js`, `PrepaymentSimulator.jsx`, wiring in `DebtDetailContainer`/`DebtsContainer`
- [x] S6.11 REFACTOR and verify: full suite, build, size checkpoint (see below)

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| S6.1/S6.2 | `reconcile.test.js` | Unit (pure, real core) | `src/features/debts` 59/59 and core 300/300 before touching the barrel and the hook | Written first; suite failed to import `reconcile.js`; barrel exact-keys test failed first (`buildCostRow` missing) | 5/5 first run | Missing row created once then second pass is a no-op; stale amount updated; backdated payment shifts a later row (update plus create); voided payment and orphan deleted while a non-debt row is untouched; zero-cost payments expect no row | `costRowFor` became the exported `buildCostRow` (JSDoc), `commit.js` uses it |
| S6.2 | `useDebtData.test.jsx` (+4) | Hook (jsdom, mocked appwrite) | 5/5 existing | Written first; 4/4 failed (`reconcileCosts` is not a function) | 9/9 | Creates with the category then finds nothing to do (no second category call); update plus delete; a failing write rejects; unknown debt does nothing | None needed |
| S6.3/S6.4 (plan) | `PlanTable.test.jsx` (+ `debtFixtures.js`) | Component (RTL) | N/A (new) | Written first; suite failed to import `PlanTable` | 5/5 after 2 test fixes (a duplicated `$ 0` query; payments that did not reach row 14) | 3 payments: rows 1-3 Pagada, 4 Próxima, last closing `$ 0`; Parcial with "Faltan", Vencida; 30-row plan pages 1-12 / 13-24 and opens on page 2 when 14 rows are paid; itemized lines vs bundled inside the total (17,950 and 111,403); phone width renders cards instead of a table | None needed |
| S6.3/S6.4 (detail) | `debtDetailModel.test.js`, `EventHistory.test.jsx`, `DebtDetail.test.jsx`, `DebtsView.test.jsx` (+2), `DebtsContainer.test.jsx` (+4) | Unit + component | `src/features/debts` 59/59; 6 of the 11 new DebtsContainer/DebtsView tests failed first | Written first; model, history and detail suites failed to import; the card and container tests failed (no open action) | 12/12 then 91/91 | Real cost totals reconcile (interest + charges + taxes), history newest first with voided flagged and reasons, void events hidden, voided payment restores balance and statuses, balance-only debt has no plan; overdue banner `$ 186.906`; repair notice and back; actions only when wired; unreadable debt; container: open and back, repair on open (create + notify + refresh), quiet when nothing to repair, non-blocking notice on failure | The detail memo and repair effect moved from `DebtsContainer` into `DebtDetailContainer` in the next commit, with tests unchanged |
| S6.5/S6.6 | `paymentModel.test.js`, `PaymentDialog.test.jsx`, `DebtDetailContainer.test.jsx` (pay flow) | Unit + component + container with a mocked port | Existing debts suite green | Written first; model and dialog suites failed to import; container pay tests failed (no `onPay`) | 6/6, 5/5, 6/6 (the model first failed once: the extra payment's `allocation.principal` already includes the extra principal, so the test caught a double count that was then removed) | Spec numbers (principal 199,505 / cost 190,876 / balance 9,800,495), extra payment needs a strategy (button disabled, no preview) then previews 1,809,124 principal, balance-only debt, invalid amount and date, empty amount stays quiet, overdue amount counts as due, core error codes to Spanish; prefill from the simulator; saving and error states, partial save locks the inputs; saved event and expense equal the preview, reload only after the writes, double tap is one event, failed save keeps the dialog and figures and the retry reuses nonce and ids, half-saved payment is completed by the retry (409 then lookup) and closing it reloads, an edited draft gets a new nonce | `previewPayment` extracted as the pure model; `useCommitDialog` shared by payment, void and (via context) the simulator conversion |
| S6.7/S6.8 | `DebtDetailContainer.test.jsx` (void flow, +3), `debtDetailModel.test.js` (+1) | Container with a mocked port | 11/11 | Written first; 2 of 3 failed (no `onVoid`); the model test already held (core behavior) | 13/13 | Confirmation first and nothing written before it; void event `dvn1` with dedupe `void:e1` and reason, `dce1` deleted, reload and refresh, "Pago anulado."; failure keeps state and the retry repeats the ids; an already voided payment offers no action | None needed |
| S6.9/S6.10 | `cashflow.test.js`, `PrepaymentSimulator.test.jsx`, `DebtDetailContainer.test.jsx` (+2), `DebtsContainer.test.jsx` (+1) | Unit + component + container | 20/20 container tests | Written first; cashflow and simulator suites failed to import; 3 container tests failed (no simulator) | 3/3, 9/9, then 127/127 in `src/features/debts` | Averages of the 3 full months (current and older excluded), unknown without income, scope filter, load failure is unknown; strategies side by side with the numbers cross-checked against `compareStrategies`, default reason, tight margin, unknown margin, higher-rate debt, 0% claims no savings, non-French identical strategies collapse to one card with a note, Ley 1555 note, conversion hands amount and strategy over, invalid amount; container: simulating writes nothing, then the payment form opens prefilled and saves an `extra_payment` with `{strategy}`; cash flow arrives and drives the verdict; other debts reach the advice | None needed |

Test summary: 68 tests written (reconcile 5, hook 4, PlanTable 5, detail model 4, EventHistory 3, DebtDetail 6, DebtsView 2, DebtsContainer 5, payment model 6, PaymentDialog 5, DebtDetailContainer 11, cashflow 3, simulator 9); `src/features/debts` 16 files / 127 tests passing (baseline 6 / 59); full suite 68 files / 692 tests (S5 baseline 58 / 624), see the known failure below. Pure functions created: `planReconcile`, `buildCostRow` (exported), `buildDebtDetail`, `previewPayment`, `dueNow`, `describeCoreError`, `averageCashflow`, `runSimulation`, `reasonTexts`.

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test | `npx vitest run src/features/debts packages/finance-core`: exit 0, 16 + 19 files, all passed (`src/features/debts` 127 tests) |
| Runtime harness | `npm test -- --maxWorkers=4`: 691 of 692 pass; the only failure is `src/app/App.test.jsx` "lazily opens Deudas…", which is environmental and not caused by S6 (see below). `npm run build` exit 0 (built in 38.8 s; `DebtsContainer` chunk 95.6 kB, 30 kB gzip). The manual `npm run dev` check (pay, void, simulate against a dev database) was not run, by instruction (no dev server, no live Appwrite); the flows run against the mocked port with the real `planCommit`/`commitPlan`/`project`/`compareStrategies`/`advise` |
| Rollback boundary | Delete the S6 files in `src/features/debts/` (`reconcile*`, `PlanTable*`, `EventHistory*`, `DebtDetail*`, `PaymentDialog*`, `VoidDialog*`, `PrepaymentSimulator*`, `debtDetailModel*`, `paymentModel*`, `prepaymentModel.js`, `cashflow*`, `saveDebtEvent.js`, `useCommitDialog.js`, `nonce.js`, `debtFixtures.js`); revert `DebtCard`/`DebtsView` (`onOpen`), `DebtsContainer` (detail delegation, `defaultNonce` import), `useDebtData` (`reconcileCosts`) and their tests, and the `buildCostRow` export in `packages/finance-core/index.js` + `src/ledger/commit.js` + `test/node16.test.js`. The list and the wizard keep working. Events and cost rows already written to Appwrite stay (append-only; a void is itself an event). |

### Follow-up fix: no double recording after a failed save
Commit `63dd02e` (see the deviation above). Focused: `npx vitest run src/features/debts` 129 tests (one wizard test timed out once under load and passed on rerun), `npm run build` exit 0.

### Known failure (pre-existing, environmental)
`App.test.jsx` "lazily opens Deudas…" (and, in some runs, "creates a debt…") fails at the 5 s `asyncUtilTimeout` of `src/test/setup.js` because the first lazy import of the debts chunk takes 10-20 s of transform time on this machine (`@finance-core` about 5 s, Radix about 2 s, wizard about 5 s on first import; the S6 modules add about 0.3 s). The same two tests fail identically in a clean worktree at the S5 head `022fda4`, and the test passes with a 30 s timeout. Under full-suite load other tests (the 200-case property in `compare.test.js`, jsdom tests) also time out occasionally; reruns are clean, as in earlier batches.

### Deviations and decisions
- **Size**: 2,066 net lines against the 2,000 ceiling (about 3% over); all four proposed PRs are within 800 lines. The unit has no slack to trim without dropping behavior tests.
- **Core touch**: `buildCostRow` is exported from `packages/finance-core` (renamed from the private `costRowFor`) so reconcile creates exactly the row a commit would. The barrel test changed RED-first.
- **Cash flow source (S6.9 open point)**: the shell only holds the selected month plus five months of history, which does not cover "the last 3 full months" when another month is selected. The simulator therefore reads the 3 full months before the current one through the existing `getTransactionsInRange` when it opens, applies the shell's `inScope` filter and averages them (`cashflow.js`). Unknown (`null`, advice reason `cashflow_unknown`) when the read fails or no income was recorded. `advise` receives the raw `{avgIncomeMinor, avgExpenseMinor, otherDebts}`; the core derives `tightMargin` and `higherRateDebt` itself (S3b decision). `otherDebts` are the other loaded, in-scope, readable debts with a balance.
- **Strategy for extra amounts**: an amount above what is due now (overdue installments plus the next one; `dueNow`) becomes an `extra_payment` and requires an explicit strategy (no default), so nothing is applied by accident. Equal or lower amounts are plain `payment` events. Balance-only debts never ask for a strategy.
- **Core behaviors surfaced**: non-French systems return `identical: true`, so the simulator shows one card "Reducir plazo o cuota" with a note instead of two equal columns; 0% debts show the verdict "Conservar liquidez" and hide savings; `installment_too_low`, `manual_plan_below_interest` and `invalid_amount` map to Spanish messages (`describeCoreError`); the Ley 1555 notice for mortgages reuses the wizard's `Notices` and never blocks.
- **Half-saved writes**: when the event is saved but the expense step fails (`CommitError`), the dialog freezes its inputs and only "Reintentar" is offered, because editing the amount would create a second movement; closing a frozen dialog reloads so the saved event shows.
- **Unknown outcome after a failure (fix after the first S6 report)**: `useCommitDialog` no longer mints a new nonce for an edited input without checking the previous attempt. An injected `findSaved({ nonce, context })` (payment: `findDebtEventByDedupe('web:{nonce}')`; void: `void:{targetId}`) decides: found -> reload, refresh, close and notify that the earlier movement was already recorded, with no second write (the user can register a new one deliberately); not found -> new nonce and write; the check itself fails -> same nonce, form locked, message "No pudimos confirmar si el intento anterior se guardó. Vuelve a intentarlo." and nothing is written. Tests: three cases in the `DebtDetailContainer` pay flow (RED first: 3 failed).
- **Void**: allowed for `payment` and `extra_payment` only; the void event is dated today, carries an optional reason (default "Anulado desde la web") and its dedupe key is `void:{targetId}`. Web nonces: event `de{nonce}`, void `dv{nonce}`, dedupe `web:{nonce}`.
- **Reconcile**: runs once per opening in `DebtDetailContainer`, only touches rows with `source: 'debt'` and an id starting `dc`, compares only the amount, and writes automatically with a toast (the design's open question keeps its current answer). Rows are created with the category from `ensureCostCategory`.
- **Container split**: `DebtDetailContainer` owns the open debt (projection, reconcile, payment, void, simulator); `DebtsContainer` keeps the list and the create flow and delegates when a debt is open. `useCommitDialog` is used by payment and void only; the S5 create flow was left as it was.
- **UI**: the plan is a table from 640 px and condensed cards below it (`useMediaQuery`); the simulator dialog widens to 760 px (`sm:w-[760px]`, same override pattern as other dialogs, not visually checked because no dev server was started).

### Notes
- Git warns about LF-to-CRLF conversion on every add (autocrlf); blobs are normalized, nothing to do.
- Owner actions still open: OA-2, OA-3 (the S4 tables must exist before S5/S6 are deployed), OA-5. The cost category "Costos financieros" is created on the first payment through `ensureCostCategory`.

## Batch 10: S7 (credit cards: core projector, wizard, detail, statements and purchases) - COMPLETE

Branch `feat/debt-s7-cards` (stacked on `feat/debt-s6d-simulator`). Five work-unit commits, each green on its own (tests with code):
- `7b0f434 feat(finance-core): project credit card statements with tranches, interest rules and management fee` (625: 619 added / 6 deleted)
- `ca4533e feat(finance-core): add card minimum payment, past due and statement adjustments` (329: 301 / 28)
- `ff17232 feat(debts): create credit cards in the wizard with cut-off days, minimum rule, management fee and installment purchases` (387: 365 / 22)
- `61256fd feat(debts): show a card's tranches, minimum payment and past-due flag, and take plain payments without a strategy` (211: 192 / 19)
- `2f738c8 feat(debts): record card statements and purchases as events and void them from the history` (422: 415 / 7)

Size: 1,974 changed lines summed over the five commits in code and tests (1,918 net against the S6 head `9e9fccf`: 1,864 added / 54 deleted, 34 files), plus this note and the task ticks. The forecast was 680 and the owner ceiling for the unit is 2,000, so the unit is inside the ceiling with 26 lines of slack. Consecutive commits group into three stacked PR branches of at most 800 lines:

| PR sub-branch (proposed) | Commits | Lines |
|---|---|---|
| `feat/debt-s7a-card-engine` | `7b0f434` | 625 |
| `feat/debt-s7b-card-minimum-wizard` | `ca4533e`, `ff17232` | 716 |
| `feat/debt-s7c-card-detail-dialogs` | `61256fd`, `2f738c8` | 633 |

(S7a+S7b would be 1,341 and S7b+S7c 1,349, hence three PRs.) No live Appwrite access of any kind: every test mocks `src/appwrite.js` or injects the port; no dev server was started.

### Tasks
- [x] S7.1/S7.2 `packages/finance-core/src/card/card.js` (`cycleDates`, `minimumPayment`, `projectCard`) and `card/config.js` (`normalizeCard`); the `card` projector is registered inside `project.js`; `terms.js` validates the card block (required for `kind: 'card'`); barrel exports `cycleDates` and `minimumPayment`. Fixture `test/fixtures/card-statement-independent.json`: independently computed and labelled as such (OA-6 still open).
- [x] S7.3/S7.4 Card wizard: `wizardModel.js` (card branch: steps Kind, Basics, Rate, Card, Review; `toTerms`, `evaluate`), `steps/CardStep.jsx`, card rows in `ReviewStep`, labels in `BasicsStep`, card option in `debtLabels.DEBT_KINDS`; `saveLoan` writes only the debt row for a card
- [x] S7.5/S7.6 Card detail: `CardPanel.jsx`, `DebtDetail.jsx` card variant, `CardDialogs.jsx` (`StatementDialog`, `ChargeDialog`; the design's proposed names were split differently: one file, shared frame), `cardModel.js` (previews), wiring in `DebtDetailContainer` (same `useCommitDialog` with the `findSaved` guard), plain payments on cards in `paymentModel`/`PaymentDialog`, void of statements and purchases
- [x] S7.7 REFACTOR and verify: full suite, build, size checkpoint (above)

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| S7.1/S7.2 (engine) | `packages/finance-core/test/card/card.test.js` + fixture | Unit + golden fixture + seeded property (60 cards) | Core suite 300/300 before touching `terms.js`, `project.js` and the barrel | Written first; suite failed to import `card.js` | 18/18 (core 318/318); 2 mutations (interest base at the due date, no first-cycle proration) failed 2 and 1 tests, then reverted | Day clamps (Feb 28/29, due next month, year end), validation of the card block and defaults, first statement vs the fixture (interest 10,392, fee 9,000, IVA 1,710, installment 100,000, total 121,102, pay in full 621,102), 12 installments of 100,000 over 12 paid statements, paid in full leaves interest 0 even with new purchases, 300,000 unpaid then 6,235 next statement, payment allocation (fee, IVA, interest, installment, revolving) and cost 21,102, the same cost through `planCommit`, deferred tranches keep their purchase rate after a card `rate_change`, one-installment purchase is ordinary, advance prorated 2,026 then 5,065, property: paying in full every cycle never bills interest (more than 200 statements asserted) | `frenchRows` helper extracted in the next commit; barrel test RED first (exact keys) |
| S7.1/S7.2 (minimum, past due, adjustment) | `test/card/card.balance.test.js` | Unit + seeded property (60 cards) | Core suite 318/318 | Written first; 14/14 failed (`minimumPayment` and handlers missing) | 14/14 (core 332/332); 2 mutations (coverage newest-first, statement minimum override removed) failed 1 and 2 tests, then reverted | Three rules, floor, cap at the whole statement; minimum 146,102 from the fixture; paid minimum is not past due and 475,000 stays revolving (interest 9,873, next minimum 144,333); short payment is partial until the due date, then past due; due-date payment counts; late payment reduces the shortfall; oldest cycle first; statement-stated minimum overrides the rule; adjustment +350 (1,000,000 to 1,000,350) with drift notice, negative drift, statement-day adjustment applied after the close, tranche reset rebuilds the installments, unabsorbable drift reported; property: paying the minimum every cycle is never past due and a short payment leaves exactly the shortfall (more than 50 short cycles asserted) | None needed |
| S7.3/S7.4 | `wizard/cardWizardModel.test.js`, `wizard/CardWizard.test.jsx`, `saveLoan.test.js` | Unit (real core) + component (RTL, user-event) | `src/features/debts` 129/129 and core 332/332 | Written first; 13/13 failed (card kind and model missing) | 13/13 first run (debts and core 474/474) | Steps and defaults; terms with opening balance, days, rule, fee + IVA link, editable pct, IVA removed, fee removed, opening balance optional, purchases with their own rate and default labels; the terms feed the projector (interest 10,392 on the first statement); 4 issues on the right step; UI: Siguiente blocked until the days are typed, IVA on by default and removable, purchase list, review rows, submitted terms; impossible day blocks with a message; card writes only the debt row (no event, no expense), 409 counts as saved | None needed |
| S7.5 (detail) | `DebtDetail.card.test.jsx`, `paymentModel.card.test.js` | Component + unit | `src/features/debts` 142/142 | Written first; 5/5 failed | 5/5 | Minimum, due date, pay in full, rate, cut-off dates, tranches with their own rate and installments left, last statement lines, no plan table and no simulator; past-due alert and chip, cleared by paying the minimum; actions only when wired; minimum, full statement and above are plain payments (no strategy) with the surplus reported | None needed |
| S7.5/S7.6 (dialogs) | `cardModel.test.js`, `DebtDetailContainer.card.test.jsx` | Unit + container with a mocked port | `src/features/debts` 147/147 | Written first; 4 of 5 failed (the fifth, "does not read ordinary expenses", holds by design: it guards that the card detail never queries transactions) | 18/18 (debts 165/165) | Statement: drift +350 and negative, minimum left to the rule, 5 invalid inputs; purchase: default labels, deferred needs 2+ installments, blank rate uses the card's, advance with and without rate, invalid amount and rate; container: statement written as an `adjustment` with the exact payload and no expense, failed save keeps the dialog and the retry repeats nonce and ids, deferred purchase writes a `charge` and the tranche and balance (2,321,102) appear only after the reload, a mistaken statement is voided from the history | Dialog frame shared in `CardDialog`; `eventWriter` shared by statement and purchase dialogs |

Test summary: 68 tests written (core 32: 18 + 14; web 36: wizard 13, detail 5, dialogs 18), 68 passing; core suite 20 files / 332 tests; full suite 77 files / 762 tests passing. Pure functions created: `cycleDates`, `minimumPayment`, `projectCard`, `normalizeCard`, `previewStatement`, `previewCharge`, `cardTerms`, `cardCharges`, `describeTranche`.

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test | `npx vitest run packages/finance-core/test/card src/features/debts`: exit 0, 25 files, 197 tests passed (one jsdom timeout on the first run under load, clean on rerun) |
| Runtime harness | `npm test -- --maxWorkers=4`: exit 0, 77 files, 762 tests (the default-worker run showed 2 unrelated jsdom timeouts under load, `DashboardView` among them). `npm run build` exit 0 (built in 18.1 s; `DebtsContainer` chunk 121.9 kB, 36.9 kB gzip). The manual `npm run dev` check (create a card, record a statement) was not run, by instruction (no dev server, no live Appwrite); the flows run against the mocked port with the real `project`/`planCommit`/`commitPlan` |
| Rollback boundary | Delete `packages/finance-core/src/card/`, `test/card/` and `test/fixtures/card-statement-independent.json`; revert `terms.js` (card block validation), `ledger/project.js` (built-in projector), the two barrel exports and the matching entries in `test/node16.test.js`; in `src/features/debts/` delete `CardPanel.jsx`, `CardDialogs.jsx`, `cardModel*.js`, `wizard/steps/CardStep.jsx`, the card tests and revert the card branches in `wizardModel.js`, `BasicsStep`, `ReviewStep`, `DebtWizard`, `DebtDetail`, `DebtDetailContainer`, `PaymentDialog`, `paymentModel`, `saveLoan`, `debtLabels`, `EventHistory`, `VoidDialog`, `debtDetailModel` and `debtFixtures`. Cards already written to Appwrite stay (append-only; a debt of `kind: 'card'` would then be read by the loan projector, so remove or archive them first). |

### Deviations and decisions
- **Size**: 1,974 lines of code and tests against the 2,000 ceiling (forecast 680). To stay inside it the card detail has no per-statement table (only the last statement and the open tranches), the simulator is not offered for cards and several small UI pieces share one frame.
- **Statement composition.** The statement has two totals: `statementTotalMinor` (spec wording: tranche installments + interest + management fee + IVA) and `payInFullMinor` (that, plus the unpaid carried amounts, the advance balances and the whole revolving balance: what avoids interest). Plan rows follow the loan row shape: `totalDueMinor` is the minimum payment, `paidMinor` what has covered it and `outstandingMinor` the shortfall, so `pastDueMinor`, `nextDue` and the list already work for cards.
- **Interest timing.** Revolving interest is billed on the next statement on what was still unpaid on the due date; it is not capitalized (an unpaid fee or interest stays billed, without interest on interest). The opening balance counts as already billed at the first cut-off date (no day count: the design's open question stays open, and a statement `adjustment` absorbs any difference). An installment purchase starts its French plan at the first statement on or after its date; a purchase in one installment is an ordinary revolving purchase (interest-free if paid by the due date), which is how "n=1 is interest-free when paid in full" is read.
- **Tranche model.** Opening installment purchases live in `terms.card.deferred` (atomic with the debt row, each with the rate fixed at purchase); later ones are `charge` events (`trancheType` revolving, deferred or advance; a blank rate uses the card rate at that time, an advance uses `card.advanceRate` first). Later `rate_change` events only change the revolving and future tranches. The opening revolving balance is `terms.principalMinor`; a card has no `disbursement` event, so `saveLoan` writes only the debt row.
- **Fee as an ordinary charge.** The management fee is the charge `mgmt_fee` in `terms.charges` with its IVA as a `pctOfCharge` link (`mgmt_iva`, 19% by default, editable or removable in the wizard); the design's `card.managementFee` field is not used. Fee and IVA are billed at every statement and become part of the cost of the payment that settles them (fees, then interest, then principal in the default allocation order).
- **Allocation of principal** inside a card payment: installments due first, then cash advances, then the billed revolving balance, then purchases not yet billed. An amount above everything billed is reported as a `surplus` notice and not applied.
- **Past due.** Payments cover the oldest unmet minimum first, so a payment made after the due date still reduces the shortfall; whether interest is charged depends only on the balance on the due date. A payment on the due date counts as on time.
- **Statements.** An `adjustment` is applied after that day's cut-off close, sets the tranche balances it names and absorbs the rest of the stated balance in the revolving balance (`absorbed:false` plus a `drift` notice if it cannot); its `minimumDueMinor` overrides the latest closed cycle. `adjustment.dueOn` is accepted by the event schema but ignored by the card projector (the cycle calendar comes from the card settings).
- **Voiding.** Statements and purchases can be voided from the history (like payments); the history shows an `Extracto` with its stated balance. `adjustment` and `charge` history labels changed from `Ajuste`/`Cargo` to `Extracto`/`Compra`.
- **Payments on a card** are never extra payments: the dialog opens with the full statement as the amount, shows the minimum and the full statement in its description and asks for no strategy.
- **Not done / left for later**: no future-cycle preview, no credit limit usage display (`limitMinor` is validated and stored only), no late interest on cards (`terms.lateRate` is not used), no card in the Nia flow (S8), the list still labels a card's next payment "Próxima cuota" (it is the minimum) and shows "Pagado 0 %" progress.

### Notes
- Git warns about LF-to-CRLF conversion on every add (autocrlf); blobs are normalized, nothing to do.
- Pre-existing jsdom flakiness under load persists (first full run: 2 timeouts; `--maxWorkers=4` run: 762/762). `App.test.jsx` lazy-load tests passed in the final run.
- Owner actions still open: OA-2, OA-3, OA-5, and OA-6 (real card statements): the card fixture is independently computed and labelled as such.
