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
