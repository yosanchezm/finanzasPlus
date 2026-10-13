# Tasks: Debt Management (cards and loans, web + Nia)

Strict TDD: every GREEN task is paired with a preceding RED task (RED -> GREEN -> REFACTOR). `npm test` = `vitest run`. Commits are work-unit commits (tests with code, docs with the behavior they explain), Conventional Commits, no AI attribution. The working tree holds unrelated uncommitted changes: always stage explicit paths, never `git add -A` or `commit -a`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (total) | about 8,100 (range 7,500-9,000): about 6,930 authored + about 1,190 in S0a (about 1,100 mechanical move) |
| 400-line budget risk | High |
| 800-line budget risk | Medium (S2, S3a, S5, S6, S8 sit within 60 lines of the limit; S0a is an accepted exception) |
| Chained PRs recommended | Yes (12 slices) |
| Suggested split | S0a -> S0b -> S1 -> S2 -> S3a -> S3b -> S4 -> S5 -> S6 -> S7 -> S8 -> S9 (see dependency graph) |
| Delivery strategy | auto-chain |
| Chain strategy | pending (orchestrator will ask: stacked-to-main / feature-branch-chain / size-exception for S0a only) |
| Review budget | 800 changed lines per slice (session `review_budget_lines=800`); default skill budget 400 is exceeded by every slice from S1 on |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
800-line budget risk: Medium

Why a decision is needed even under `auto-chain`: (1) the chain strategy is not chosen yet and the PR base boundaries depend on it; (2) S0a is `size:exception` and is destructive, so it needs explicit owner confirmation (task S0a.1) before anything touches `functions/nia/.git`.

Per-slice estimate (authored additions + deletions, tests and docs included):

| Slice | Est. lines | 800 risk | Overflow valve (pre-declared split) |
|---|---|---|---|
| S0a | about 1,190 (1,100 moved) | Exception (`size:exception`) | none; mechanical move |
| S0b | about 340 | Low | none |
| S1 | 520 | Low | none |
| S2 | 740 | Medium | S2a = terms + French/German + totals; S2b = bullet/interest-only/manual/grace + charges |
| S3a | 760 | Medium-High | S3a-1 = events, allocate, project; S3a-2 = commit |
| S3b | 600 | Low | none |
| S4 | about 450 | Low | none |
| S5 | 760 | Medium-High | S5a = viewModel, hook, list, nav; S5b = wizard |
| S6 | 760 | Medium-High | S6a = reconcile, detail, plan, history; S6b = payment, void, simulator |
| S7 | 680 | Medium | S7a = core card; S7b = web card |
| S8 | 740 | Medium-High | S8a = findDebt, extract, pending, preview; S8b = handler, wiring |
| S9 | about 580 | Low | none |

Each slice ends with a size checkpoint task: run `git diff --stat` against the slice base; if authored lines (goldens and fixture JSON excluded from the authored count) exceed 800, split at the valve above before opening the PR.

### Suggested Work Units

PR bases depend on the chain strategy (pending). For `feature-branch-chain`: PR 1 base = tracker branch, PR N base = PR N-1 branch. For `stacked-to-main`: each PR targets main after the previous one merges.

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| S0a | Nia is plain files in the repo; tarballs untracked | PR 1 (`size:exception`) | `npx vitest run src/test/niaInRepo.test.js` | `git -C <root> ls-files -s functions/nia` shows 100644 entries only | Restore `.git` from the backup, `git rm -r --cached functions/nia`, `git update-index --add --cacheinfo 160000,<sha>,functions/nia` |
| S0b | `npm run package:nia` produces a deployable tarball | PR 2 | `npx vitest run scripts/` | `npm run package:nia`, then load the bundle and GET returns `{ok:true, service:'nia'}` | Remove `scripts/package-nia.mjs`, `scripts/lib/tar.mjs`, the npm script and doc sections |
| S1 | Core: money, calendar, rates, legal notices | PR 3 | `npx vitest run packages/finance-core/test/rates.test.js packages/finance-core/test/calendar.test.js packages/finance-core/test/legal.test.js packages/finance-core/test/node16.test.js` | N/A: pure functions with no runtime boundary; property tests are the harness | Delete `packages/finance-core/` |
| S2 | Core: terms, schedules, charges | PR 4 | `npx vitest run packages/finance-core/test/schedule.test.js packages/finance-core/test/charges.test.js` | N/A: pure functions; golden fixtures plus 200-case property tests | Delete `src/terms.js`, `src/schedule/`, `src/charges.js`, fixtures |
| S3a | Core: events, allocation, `project()`, `planCommit`/`commitPlan` | PR 5 | `npx vitest run packages/finance-core/test/ledger` | N/A: pure core with a fake port | Delete `src/ledger/` and its tests |
| S3b | Core: simulation, comparison, advice, facts | PR 6 | `npx vitest run packages/finance-core/test/prepay packages/finance-core/test/advice` | N/A: pure functions | Delete `src/prepay/`, `src/advice/` |
| S4 | Schema, data layer, alias (migration is owner-side) | PR 7 | `npx vitest run scripts/lib/debt-schema.test.js src/appwrite.test.js src/test/financeCoreAlias.test.js` | Owner runs `npm run migrate:appwrite` on a dev database twice; the second run changes nothing | Revert code; new tables may stay unused |
| S5 | Web: nav, list, loan wizard | PR 8 | `npx vitest run src/features/debts src/features/shell src/app` | `npm run dev`: open Deudas, create a loan | Remove `src/features/debts/` and the nav entries |
| S6 | Web: detail, plan, payment, void, simulator, reconcile | PR 9 | `npx vitest run src/features/debts` | `npm run dev`: pay, void, simulate against a dev database | Revert the detail and payment files; the list stays |
| S7 | Credit card (core + web) | PR 10 | `npx vitest run packages/finance-core/test/card src/features/debts` | `npm run dev`: create a card, record a statement | Unregister the card projector; remove card files |
| S8 | Nia: create, list, pay, selector, dedupe | PR 11 | `npx vitest run functions/nia scripts/package-nia.test.js` | `npm run package:nia` and smoke GET; owner Telegram test on a dev bot | Remove the `debt` intent and `functions/nia/debt/`; redeploy the previous tarball |
| S9 | Nia: simulate, advise, guardrails, snapshot | PR 12 | `npx vitest run functions/nia` | `npm run package:nia`; owner Telegram test | Remove simulate/advise wiring; redeploy the previous tarball |

### Dependency graph and parallelism

- Sequential chain (one writer): S0a -> S0b -> S1 -> S2 -> S3a -> S3b -> S4 -> S5 -> S6 -> S7 -> S8 -> S9.
- Independent in content (no shared files), so the order may change if the owner has not confirmed S0a: S0a/S0b can move after S1-S3b. Hard dependencies only: S1->S2->S3a->S3b; S3a->S4->S5->S6->S7; S0b and S4 -> S8; S3b and S8 -> S9.
- Never run parallel writers.

## Owner-side manual actions (never automated by apply)

| ID | Action | When | Blocks |
|---|---|---|---|
| OA-1 | Confirm S0a: read the S0a.1 gate and answer explicitly | Before S0a.2 | S0a, S0b, S8, S9 |
| OA-2 | Run the Transactions API spike script against a scratch database on self-hosted 1.8.1 and report the result | During S4 (task S4.2) | Only S4.8-S4.9 (optional wrapper) |
| OA-3 | Run `npm run migrate:appwrite` against the live Appwrite, after trying it twice on a dev database | After S4 merges, before deploying S4 or later | Deploying S5+ and S8+ |
| OA-4 | Upload `functions/nia.tar.gz` to the Appwrite Function | After S0b (smoke), after S8 (optional), after S9 (final) | None |
| OA-5 | Supply current values for `USURY_TABLE` and `SMMLV_TABLE` (cap, validFrom, validTo, source). Without them the table ships empty/marked placeholder | Before S1 merges | Real usury notices |
| OA-6 | Supply real statements (libranza with insurance + GMF + IVA, card statement) for the golden fixtures. Without them the fixtures are independently computed and labelled so | Before S2 and S7 merge | "Hand-checked against real statements" claim |

## Phase S0a: Nia in-repo (size:exception, destructive, gated)

Capabilities: nia-in-repo-packaging. Nothing past S0a.1 runs until the owner confirms.

- [x] S0a.1 STOP: obtain owner confirmation before touching `functions/nia/.git`; back up the nested `.git` outside the repo. No automation, script or command past this task until the owner confirms in writing. Files: none. Reqs: NIP-2. Pair: n/a (gate). Done: the confirmation text is recorded in the PR description; if not confirmed, S0a/S0b stay unstarted and the apply run reports `blocked` for them.
- [x] S0a.2 Preflight (read only, `git -C <absolute path>` everywhere): `ls-files -s functions/nia` shows mode 160000; `git -C functions/nia rev-parse --show-toplevel` equals the nested root; record `status --porcelain` and `rev-parse HEAD` of the nested repo. Reqs: NIP-1, NIP-2. Pair: n/a. Done: values saved in the PR description; abort if the toplevel is not the nested root.
- [x] S0a.3 RED: `src/test/niaInRepo.test.js` (`// @vitest-environment node`, `execFileSync('git', ['-C', root, ...])`, no shell): `ls-files -s functions/nia` has no 160000 and lists `index.js`, `package.json`, `README.md` as 100644; no `functions/nia/.git`; nothing under `node_modules/` or `functions/*.tar.gz` tracked; `git check-ignore functions/nia.tar.gz dist-nia` succeed; `.dockerignore` lists `dist-nia` and not `packages`. Reqs: NIP-1, NIP-4 (threat matrix: repo selection, commit state). Pair: S0a.5, S0a.6. Done: test fails for the right reason (gitlink present).
- [x] S0a.4 Backup, abort on any failure: copy `functions/nia/.git` to `%USERPROFILE%\backups\finanzasplus-nia-git-<timestamp>\`; `git -C functions/nia bundle create <backup>\nia.bundle --all`; `git bundle verify`. Reqs: NIP-2 ("Backup fails"). Pair: n/a (procedural). Done: bundle verifies; if any step fails, `.git` is left and the gitlink is not untracked.
- [x] S0a.5 GREEN: `git -C <root> rm --cached functions/nia`; delete `functions/nia/.git` only after S0a.4 verified; `git add` explicit paths `functions/nia/index.js functions/nia/package.json functions/nia/README.md` (create README only if absent; add the lockfile if present). Files: `functions/nia/*`. Reqs: NIP-1. Pair: S0a.3. Done: working-tree content preserved byte for byte (compare with the recorded status), `ls-files -s` shows no 160000.
- [x] S0a.6 GREEN: `git rm --cached functions/nia.tar.gz functions/nia-deploy.tar.gz` (files stay on disk); add `dist-nia/` to `.gitignore` (`functions/*.tar.gz` is already ignored); add `dist-nia` to `.dockerignore` (keep `packages` included; `Dockerfile` uses `COPY . .`). Files: `.gitignore`, `.dockerignore`. Reqs: NIP-4. Pair: S0a.3. Done: `niaInRepo.test.js` fully green.
- [x] S0a.7 REFACTOR and verify: `npm test`, `npm run build`; commit `chore(nia): track functions/nia as plain files` with explicit pathspecs. Reqs: NIP-1, NIP-4. Done: PR labelled `size:exception`, rollback steps from the design pasted in the PR.

## Phase S0b: Packaging script (about 340 lines)

- [x] S0b.1 RED: `scripts/lib/tar.test.js`: ustar header checksum correct, 512-byte padding, two zero end blocks, names over 100 chars rejected, gzip round-trip with `zlib.gunzipSync`. Reqs: NIP-3. Pair: S0b.2. Done: fails (module missing).
- [x] S0b.2 GREEN: `scripts/lib/tar.mjs` in-process ustar writer. Reqs: NIP-3. Pair: S0b.1. Done: tests green.
- [x] S0b.3 RED: `scripts/package-nia.test.js` (node environment, timeout 60 s): `execFileSync(process.execPath, ['scripts/package-nia.mjs', '--out', tmp])` (no shell; `--out` redirects both `dist-nia` and the tarball under `tmp` so the real `functions/nia.tar.gz` is untouched); tarball holds exactly `index.js` and `package.json`; every `import` in `dist-nia/index.js` is a `node:` built-in or `undici`; the bundle loads with stubbed env and GET returns `{ok:true, service:'nia'}`; the forbidden-API scan fails on a fixture containing `findLast`. Reqs: NIP-3 (threat matrix: subprocess). Pair: S0b.4. Done: fails (script missing).
- [x] S0b.4 GREEN: `scripts/package-nia.mjs` exporting `packageNia({outDir, tarPath})` per AD12 (Vite `build({configFile:false, ssr:{external:['undici']}, build:{ssr:'functions/nia/index.js', target:'node16', minify:false, rolldownOptions}})`, generated `dist-nia/package.json` with `undici@5.28.5`, post-build API scan, tar via `scripts/lib/tar.mjs`). Reqs: NIP-3. Pair: S0b.3. Done: tests green.
- [x] S0b.5 Add `"package:nia": "node scripts/package-nia.mjs"` to `package.json`. Reqs: NIP-3. Pair: covered by S0b.3. Done: `npm run package:nia` writes `functions/nia.tar.gz` and `git status` shows no untracked tarball (NIP-4 "Generated archive ignored").
- [x] S0b.6 Docs (match each file's existing language, currently Spanish): `docs/setup.md` section 5 (Nia Function: run `npm run package:nia`, upload the tarball); `docs/deploy.md` (the web image needs `packages/` and does not use `functions/`; Nia is deployed separately); `functions/nia/README.md` (packaging, Node16 target, env vars). Reqs: NIP-3. Pair: n/a (docs). Done: commands copy-pasted and verified once.
- [x] S0b.7 REFACTOR: dedupe helpers, `npm test`, size checkpoint. Done: PR-ready; owner action OA-4 noted (upload after merge).

## Phase S1: Core foundation (520 lines)

- [x] S1.1 RED: `packages/finance-core/test/money.test.js`: `roundUnit` half away from zero (including negatives and unit 100), `sumMinor`, `assertMinor` rejects non-integers/NaN. Reqs: DAS-1 (AD5). Pair: S1.2. Done: fails.
- [x] S1.2 GREEN: `packages/finance-core/src/money.js`. Pair: S1.1. Done: green.
- [x] S1.3 RED: `test/calendar.test.js`: `isIsoDate`, `addDays`, `addMonthsClamped` (2026-01-31 -> 2026-02-28 -> 2026-03-31, leap-year 02-29), `periodDates` for weekly, biweekly (14 days), monthly, bimonthly, quarterly, semiannual, annual, `daysBetween`, `compareIso`; `Date.UTC` only. Reqs: IRC-3. Pair: S1.4. Done: fails.
- [x] S1.4 GREEN: `src/calendar.js`. Pair: S1.3. Done: green.
- [x] S1.5 RED: `test/rates.test.js` plus helper `test/helpers/prng.js` (`mulberry32`, 10 lines): 24% EA monthly i within 1e-6 and round trip 1e-9; 2.1% MV and 25.2% NAMV both give about 28.32% EA; 2% monthly anticipated i = 0.02/0.98 and `(1-ia)^-m - 1`; interest-free (ZERO) gives 0/0; seeded 0-60% round trip over every convention, periodicity and timing within 1e-9; anticipated 100%, negative or non-finite throws a typed validation error and returns no number; `rateLabel` -> `"2.1% MV ≈ 28.32% EA"`. Reqs: IRC-1, IRC-2. Pair: S1.6. Done: fails.
- [x] S1.6 GREEN: `src/rates.js` (`CONVENTIONS`, `normalizeRate`, `periodicRate`, `toEffectiveAnnual`, `convertRate`, `rateLabel`). Pair: S1.5. Done: green.
- [x] S1.7 RED: `test/legal.test.js` (tables injected): 30% EA vs a 28.59% consumer cap as of 2026-10 returns a warning with cap and `asOf`; no cap entry returns no warning and does not throw; below cap none; `ley1555Notice` for a mortgage says scope is unverified and includes `asOf`; notices never block. Reqs: IRC-4, DPA-4. Pair: S1.8. Done: fails.
- [x] S1.8 GREEN: `src/legal.js` with `USURY_TABLE`/`SMMLV_TABLE` filled from OA-5 (empty or marked placeholder otherwise). Pair: S1.7. Done: green.
- [x] S1.9 RED: `test/node16.test.js` (node environment): scan every `packages/finance-core/**/*.js` for `findLast`, `toSorted`, `toReversed`, `structuredClone`, `Object.groupBy`, array `.at(`, regex `v` flag; barrel test that `index.js` exports the public API only. Reqs: NIP-3 (Node16 safety). Pair: S1.10. Done: fails (barrel missing).
- [x] S1.10 GREEN and REFACTOR: `packages/finance-core/index.js` barrel; size checkpoint; `npm test`. Pair: S1.9. Done: green.

## Phase S2: Terms, schedules, charges (740 lines)

- [x] S2.1 RED: `test/terms.test.js`: `validateTerms` (negative principal, invalid anticipated rate, bad dates), `serializeTerms` throws `TermsTooLarge` over 8000 chars, a 120-row `manualPlan` fits, `schemaVersion` always present, `parseTerms` migrates by version. Reqs: DL-6 (schemaVersion), DAS-1, DWM-2 (core validation). Pair: S2.2. Done: fails.
- [x] S2.2 GREEN: `src/terms.js`. Pair: S2.1. Done: green.
- [x] S2.3 RED: `test/schedule.french.test.js` + `test/fixtures/french-10m-24ea-36.json`: P=10,000,000, 24% EA, 36 months, interest 1 about 180,876 (+/-1), installment 380,381 (+/-1), installments 1-35 equal, last differs by at most 36, principal sums to P, closing 0; interest-free French 1,200,000 x 12 = 100,000 each. Reqs: DAS-1. Pair: S2.4. Done: fails.
- [x] S2.4 GREEN: `src/schedule/index.js` (`buildSchedule` dispatch) and `french.js`. Pair: S2.3. Done: green.
- [x] S2.5 RED: `test/schedule.systems.test.js`: German 1,200,000 x 12 (principal 100,000 +/-1, interest and total non-increasing); bullet; interest-only with a 5,000,000 balloon (last principal = balloon, balance 0); manual plan; total grace 2 months (balance exceeds P, final 0); principal-only grace 3 months (principal 0 and interest > 0 when rate > 0); grace rows still listed; seeded 200-case property test (principal sums to P, final balance 0, integers >= 0). Reqs: DAS-1, DAS-2. Pair: S2.6. Done: fails.
- [x] S2.6 GREEN: `german.js`, `bullet.js`, `interestOnly.js`, `manual.js`, `grace.js`. Pair: S2.5. Done: green.
- [x] S2.7 RED: `test/charges.test.js` + libranza fixture (insurance + GMF + IVA; OA-6 if available): GMF 0.4% of a 400,000 subtotal = 1,600; IVA 19% of a 10,000 fixed fee = 1,900 and fee + IVA = 11,900 (assert `chargesMinor` 10,000 and `taxesMinor` 1,900, which together are the spec's 11,900); annual insurance 600,000 for periods 1-24 on 36 months appears in periods 1 and 13 only; evaluation order base -> pctOfCharge -> pctOfSubtotal; `display:'bundled'` vs `'itemized'` give identical totals; a charge never changes principal; `summarizeSchedule` totals reconcile (sum of installments = principal + interest + charges + taxes, +/-1 per row) over 200 seeded cases. Reqs: DAS-3, DAS-4. Pair: S2.8. Done: fails.
- [x] S2.8 GREEN: `src/charges.js` (`evaluateCharges`), integrate into rows (`charges[]`, `chargesMinor`, `taxesMinor`, `totalDueMinor`), add `summarizeSchedule` exported from `schedule/index.js` (small addition to the design's export list). Pair: S2.7. Done: green.
- [x] S2.9 REFACTOR and size checkpoint: shared rounding helper, barrel exports, `npm test`. Done: if over 800 lines, split at the S2a/S2b valve.

## Phase S3a: Ledger, projection, commit (760 lines)

- [x] S3a.1 RED: `test/ledger/events.test.js`: `EVENT_KINDS`, `validateEvent` per payload table, `activeEvents` drops voided events and void events, `sortEvents` (effectiveOn then `$createdAt`), shuffled storage order projects deeply equal. Reqs: DL-1, DL-2. Pair: S3a.2. Done: fails.
- [x] S3a.2 GREEN: `src/ledger/events.js`. Pair: S3a.1. Done: green.
- [x] S3a.3 RED: `test/ledger/allocate.test.js`: short payment 100,000 on charges 10,000 / interest 180,876 / principal 199,505 -> charges 10,000, interest 90,000, principal 0, remaining interest 90,876 plus full principal; exact payment equals the row; surplus; custom `allocationOrder`; `bankSplit` override; late-interest bucket; allocated total equals amount (property). Reqs: DL-3. Pair: S3a.4. Done: fails.
- [x] S3a.4 GREEN: `src/ledger/allocate.js`. Pair: S3a.3. Done: green.
- [x] S3a.5 RED: `test/ledger/project.test.js`: plan status table (paid, partial, due, pastDue, future) and `pastDueMinor`; family 0% informal `system:'none'` balance = principal - payments, never below 0; void restores the projection (200 seeded cases); idempotent replay; `rate_change` keep_term/keep_installment; `charge_change`; `restructure` bumps `termsVersion`; `extra_payment` at 0% (1,200,000 x 12, 1 paid, +300,000 -> reduce term 8 remaining at 100,000; reduce installment 11 remaining at about 72,727; advance saves no interest); `adjustment` records `drift`; `taxesPaid` reported apart; projector registry (`registerProjector`). Reqs: DL-1, DL-2, DL-4. Pair: S3a.6. Done: fails.
- [x] S3a.6 GREEN: `src/ledger/project.js` with the default loan projector and the registry. Pair: S3a.5. Done: green.
- [x] S3a.7 RED: `test/ledger/commit.test.js` (fake port): `planCommit` cost = charges + taxes + lateInterest + interest (190,876 on the 10,000 / 180,876 / 199,505 split), principal never an expense, `costMinor=0` -> `costRow:null`, row id `dc{eventId}`, fields per design (`source:'debt'`, `debtId`, `dedupeKey debt:{eventId}`, ownerScope from the debt); `commitPlan`: 409 on event -> `findEventByDedupe`, retry creates no second event or row, 409 on cost row counts as success, row failure after event reports a failed save (retry completes it), void deletes `dc{id}` with 404 treated as success, `ensureCostCategory` called, optional `port.atomic` absent works. Reqs: DL-5. Pair: S3a.8. Done: fails. Note: the design lists these under S4; they belong here because `commit.js` is a S3a file.
- [x] S3a.8 GREEN: `src/ledger/commit.js` (`planCommit`, `commitPlan`). Pair: S3a.7. Done: green.
- [x] S3a.9 REFACTOR and size checkpoint: barrel exports, `npm test`. Done: if over 800, split commit into S3a-2.

## Phase S3b: Prepayment and advice (600 lines)

- [ ] S3b.1 RED: `test/prepay/simulate.test.js`, `compare.test.js`: French 10,000,000 at 24% EA, 36 months, after 12 payments, extra 2,000,000 (reduce term: fewer installments, same installment; reduce installment: same term, lower installment; interest saved reduce_term >= reduce_installment, also over 200 seeded cases); advance saves 0; extra above balance caps at full payoff with no negative balance; inputs not mutated (read-only); 0% debt saves 0; `prepaymentPenaltyPct` informational, default 0. Reqs: DPA-1. Pair: S3b.2. Done: fails.
- [ ] S3b.2 GREEN: `src/prepay/simulate.js`, `compare.js`. Pair: S3b.1. Done: green.
- [ ] S3b.3 RED: `test/advice/advice.test.js`: truth table (default reduce_term; tight margin -> reduce_installment citing margin/ratio; card 35% EA vs loan 18% -> avalanche; 0% -> liquidity_only with no savings claim; tight and higher-rate -> reduce_installment with reason `higher_rate_debt`; gap 0 means strictly higher; thresholds configurable via `ADVICE_DEFAULTS`); `buildFacts` contains every number the rendered summary shows plus a reason code per signal; mortgage Ley 1555 notice with `asOf` and the simulation is still produced. Reqs: DPA-2, DPA-3, DPA-4. Pair: S3b.4. Done: fails.
- [ ] S3b.4 GREEN: `src/advice/advice.js`, `facts.js`. Pair: S3b.3. Done: green.
- [ ] S3b.5 REFACTOR and size checkpoint: barrel exports, `npm test`.

## Phase S4: Schema, data layer, alias (about 450 lines)

- [ ] S4.1 Spike prep (no live access): confirm the installed `appwrite` SDK exposes `TablesDB.createTransaction`, `createOperations`, `updateTransaction`; write `scripts/spike-transactions.mjs` (kept local, not committed unless the owner wants it) that begins a transaction, stages two row creates (one with a duplicate unique key), commits, and checks rollback plus per-row permissions. Reqs: DL-5 (AD6). Pair: n/a (spike). Done: script reviewed; it targets a scratch database only and never the live tables. Naming note: do not confuse SDK `createTransaction` with the existing `createTransaction` in `src/appwrite.js` (finance transactions).
- [ ] S4.2 Owner action OA-2: the owner runs the spike on self-hosted 1.8.1 and records PASS / FAIL / INCONCLUSIVE with the version in `openspec/changes/debt-management/spike-transactions.md`. Decision rule: PASS -> do S4.8-S4.9; FAIL, INCONCLUSIVE or not run -> fallback is the sequential idempotent path already designed (unique `dedupeKey`, deterministic `dc{eventId}`, reconcile on read), S4.8-S4.9 are skipped. Done: decision recorded; S5+ are not blocked either way.
- [ ] S4.3 RED: `scripts/lib/debt-schema.test.js`: snapshot of `debts` (columns and sizes, `termsJson` 8000, index `by_household_status`), `debt_events` (`payloadJson` 8000, `dedupeKey` 160, unique `by_dedupe`, `by_household_debt_date`), `transactions.debtId` (s36 optional, index `by_household_debt`), permissions (debts: team read/create/update; debt_events: team read/create), additive only (new keys do not collide with existing ones). Reqs: DL-6. Pair: S4.4. Done: fails.
- [ ] S4.4 GREEN: `scripts/lib/debt-schema.mjs` (plain data, no helper dependency) imported by `scripts/migrate-appwrite.mjs`, which appends the two tables and merges the `transactions` column and index (the script keeps its create-only `ensure*` loops, which provide the rerun idempotence). Reqs: DL-6. Pair: S4.3. Done: green; `node --check scripts/migrate-appwrite.mjs`. Never run against the live Appwrite here (OA-3).
- [ ] S4.5 RED: extend `src/appwrite.test.js` (`vi.mock('appwrite')`): `TABLES.debts`/`debtEvents`; `listDebts`, `listDebtEvents`; `createDebt` (row perms team read/update, no delete); `createDebtEvent` (team read only); `findDebtEventByDedupe`; `createCostRow` (id `dc{eventId}`, team read/update/delete, 409 surfaced as conflict); `updateCostRow`; `deleteCostRow` (404 as success); `listCostRows` by `debtId`; `ensureCostCategory` (folded-name lookup, else create `cf{householdId}` with kind `need`, 409 re-reads); `debtPort()` matches the `commitPlan` port; existing exports unchanged. Reqs: DL-5, DL-1. Pair: S4.6. Done: fails.
- [ ] S4.6 GREEN: `src/appwrite.js` additions listed in the design. Pair: S4.5. Done: green.
- [ ] S4.7 RED then GREEN (one work unit): `src/test/financeCoreAlias.test.js` (`import { buildSchedule, project } from '@finance-core'`; `.dockerignore` does not exclude `packages`), then `vite.config.js` `resolve.alias['@finance-core']`. Reqs: AD3. Pair: itself (RED first, then alias). Done: green, `npm run build` passes.
- [ ] S4.8 RED (only if S4.2 = PASS): `commit.test.js` additions: `port.atomic` wraps event + cost row in one transaction, rolls back on failure, falls back to the sequential path when the API reports unsupported. Reqs: DL-5. Pair: S4.9. Done: fails.
- [ ] S4.9 GREEN (only if S4.2 = PASS): atomic wrapper in `src/ledger/commit.js` and `debtPort().atomic`. Pair: S4.8. Done: green; otherwise mark S4.8-S4.9 "skipped: fallback adopted".
- [ ] S4.10 Docs: `docs/setup.md` section 3 (re-run `npm run migrate:appwrite` before deploying S4 or later; additive; second run changes nothing). Reqs: DL-6. Pair: n/a (docs). Done: step matches OA-3.
- [ ] S4.11 REFACTOR and verify: `npm test`, `npm run build`, size checkpoint.

## Phase S5: Web navigation, list, loan wizard (760 lines)

- [ ] S5.1 RED: `src/features/debts/debtViewModel.test.js`: projects each debt, totals (balance, monthly installments, next due), `inScope` filter hides another member's personal debt, not month-scoped. Reqs: DWM-1. Pair: S5.2. Done: fails.
- [ ] S5.2 GREEN: `debtViewModel.js`. Pair: S5.1.
- [ ] S5.3 RED: `useDebtData.test.jsx`: loads `debts` and `debt_events` with `listAllRows` (mocked), states loading -> ready, failure -> `status:'error'` with `retry`, `reload`. Reqs: DWM-6. Pair: S5.4. Done: fails.
- [ ] S5.4 GREEN: `useDebtData.js`. Pair: S5.3.
- [ ] S5.5 RED: `DebtsView.test.jsx`: both debts listed (name, lender, balance, next installment and date, EA), totals equal the sum, empty state with a create action, load failure shows an error panel with "Reintentar" and no stale totals. Reqs: DWM-1, DWM-6. Pair: S5.6. Done: fails.
- [ ] S5.6 GREEN: `DebtsView.jsx`, `DebtCard.jsx`, `DebtsContainer.jsx` (list and create handler with `saveState` and a dialog nonce). Pair: S5.5.
- [ ] S5.7 RED: `wizard/wizardModel.test.js`: reducer and steps per kind (consumer/vehicle/libranza, mortgage German/French, leasing balloon, family rate ZERO default, informal `system:'none'`), charge presets (seguro de vida `pctOutstanding`, GMF `pctOfSubtotal` 0.4, IVA `pctOfCharge` 19), validation (negative principal, invalid anticipated rate), `toTerms()` passes `validateTerms`. Reqs: DWM-2. Pair: S5.8. Done: fails.
- [ ] S5.8 GREEN: `wizard/wizardModel.js`. Pair: S5.7.
- [ ] S5.9 RED: `wizard/DebtWizard.test.jsx` (jsdom + user-event): 2.1% monthly nominal echoes about 28.3% EA; 0% French saves with zero interest; first installment shown before saving; usury warning does not disable save; invalid input disables save with an inline message; save failure keeps the dialog open with `readableError` and "Reintentar", the same nonce is reused and the list stays unchanged; creation writes the debt plus the `disbursement` event with deterministic ids (`db{nonce}`, dedupe `web:{nonce}:disb`) and no income row. Reqs: DWM-2, DWM-6, IRC-4, DL-1. Pair: S5.10. Done: fails.
- [ ] S5.10 GREEN: `RateField.jsx`, `wizard/DebtWizard.jsx`, `steps/{Kind,Basics,Rate,Plan,Charges,Review}Step.jsx` (Radix Dialog). Pair: S5.9.
- [ ] S5.11 RED: nav tests (extend existing shell tests): Sidebar and MoreSheet show "Deudas"; `MobileTabBar` only forwards `onNavigate`; `FinanceShell` lazily renders `DebtsContainer` for 'Deudas' with `inScope`, `currentOwnerScope`, `user`, `categories`, `onRefresh`; the period switcher is hidden. Reqs: DWM-1. Pair: S5.12. Done: fails.
- [ ] S5.12 GREEN: `src/features/shell/navItems.js` (CreditCard icon), `MoreSheet.jsx`, `MobileTabBar.jsx`, `src/app/FinanceShell.jsx` (lazy case; not in `PERIOD_VIEWS`). Pair: S5.11. Done: green.
- [ ] S5.13 REFACTOR and verify: `npm test`, `npm run build`, size checkpoint (valve: S5a/S5b).

## Phase S6: Detail, plan, payment, void, simulator, reconcile (760 lines)

- [ ] S6.1 RED: `src/features/debts/reconcile.test.js` (pure `planReconcile(debt, events, costRows)`): a missing row is created once, a stale amount updated, an orphan (voided or backdated) deleted, a second pass is a no-op. Reqs: DL-5 ("Atomic or reconcilable"). Pair: S6.2. Done: fails.
- [ ] S6.2 GREEN: `reconcile.js` and `useDebtData.reconcileCosts(debtId)` on detail open, with a toast and a non-blocking notice when it fails. Pair: S6.1.
- [ ] S6.3 RED: `DebtDetail.test.jsx`, `PlanTable.test.jsx`, `EventHistory.test.jsx`: 3 payments on 12 installments -> rows 1-3 paid, row 4 due, last closing 0; chips for partial and pastDue; paginated plan; real-cost totals; itemized charge lines vs bundled totals; history includes voided events and a void action. Reqs: DWM-3. Pair: S6.4. Done: fails.
- [ ] S6.4 GREEN: `DebtDetail.jsx`, `PlanTable.jsx`, `EventHistory.jsx` (rendering `projection.plan` only). Pair: S6.3.
- [ ] S6.5 RED: `PaymentDialog.test.jsx`: preview split principal 199,505 / cost 190,876 labelled "Vista previa"; an amount above the installment requires a strategy; saved event and expense equal the preview; double tap creates one event (same nonce); save error keeps the dialog open, projection unchanged, retry reuses the nonce; `reload()`/`onRefresh` only after `commitPlan` resolves. Reqs: DWM-4, DWM-6, DL-5. Pair: S6.6. Done: fails.
- [ ] S6.6 GREEN: `PaymentDialog.jsx` and the pay handler in `DebtsContainer.jsx`. Pair: S6.5.
- [ ] S6.7 RED: void flow tests: confirmation dialog, `void` event appended plus cost row `dc{id}` deleted, balance returns to the prior value, failure leaves state unchanged. Reqs: DWM-4, DL-1, DL-5. Pair: S6.8. Done: fails.
- [ ] S6.8 GREEN: void handler. Pair: S6.7.
- [ ] S6.9 RED: `PrepaymentSimulator.test.jsx`: amount -> strategies side by side (term, installment, interest and charges saved) with verdict and reason; no write mock is called; 0% shows liquidity-only; "Registrar como abono" opens `PaymentDialog` prefilled with amount and strategy. Reqs: DWM-5, DPA-1, DPA-2. Pair: S6.10. Done: fails. Open point: the web needs `advise` signals; pass `higherRateDebt` computed from the other loaded debts and `tightMargin` only if the shell exposes 3-month income and expense, else null (confirm at apply).
- [ ] S6.10 GREEN: `PrepaymentSimulator.jsx` and wiring. Pair: S6.9.
- [ ] S6.11 REFACTOR and verify: `npm test`, `npm run build`, size checkpoint (valve: S6a/S6b).

## Phase S7: Credit card (680 lines)

- [ ] S7.1 RED: `packages/finance-core/test/card/card.test.js` + statement fixture (OA-6): `cycleDates` clamps (day 31 in February); `minimumPayment` per rule with a floor, overridden by `adjustment.minimumDueMinor`; revolving 500,000 at 28% EA plus deferred 1,200,000 x 12 at 0% -> 12 x 100,000, revolving at its own rate, statement total = tranche installments + interest + management fee; a later card `rate_change` leaves existing tranche rates; paid in full by the due date -> interest 0; 300,000 unpaid -> next statement includes interest; advance accrues from its date; pay minimum -> not past due and the remainder stays revolving; below minimum -> shortfall `pastDue`; adjustment +350 -> 1,000,350; a plain expense transaction leaves the balance unchanged; fee + IVA link included in the cost. Reqs: CCD-1, CCD-2, CCD-3, CCD-4. Pair: S7.2. Done: fails.
- [ ] S7.2 GREEN: `packages/finance-core/src/card/card.js` and `registerProjector('card', projectCard)`; barrel exports. Pair: S7.1.
- [ ] S7.3 RED: wizard card tests: steps Kind -> Basics -> Rate -> Card -> Review, Card step fields (statement and due day, minimum rule, fee with IVA link by default and editable, initial revolving balance, deferred purchases), `toTerms()` valid. Reqs: CCD-1, CCD-3, DWM-2. Pair: S7.4. Done: fails.
- [ ] S7.4 GREEN: `steps/CardStep.jsx`, card branch in `wizardModel.js`, card option in `KindStep`. Pair: S7.3.
- [ ] S7.5 RED: card detail tests: tranches and cycle shown, minimum payment and past-due flag, statement dialog writes an `adjustment`, charge dialog writes a `charge` event (deferred tranche appears), a normal expense does not move the balance. Reqs: CCD-1, CCD-3, CCD-4. Pair: S7.6. Done: fails.
- [ ] S7.6 GREEN: `CardPanel.jsx`, `StatementDialog.jsx`, `ChargeDialog.jsx` (names proposed; "card detail bits" in the design). Pair: S7.5.
- [ ] S7.7 REFACTOR and verify: `npm test`, `npm run build`, size checkpoint (valve: S7a/S7b).

## Phase S8: Nia create, list, pay (740 lines)

Precondition: S0b merged and S4 merged (data layer shape).

- [ ] S8.1 RED: `functions/nia/debt/findDebt.test.js`: "vehiculo" matches "Crédito Vehículo"; priority exact name > contains name or lender > kind synonyms; two "banco" debts -> candidates; no match with one active debt -> that debt; no match with several -> none. Reqs: NDA-3. Pair: S8.2. Done: fails.
- [ ] S8.2 GREEN: `findDebt.js`. Pair: S8.1.
- [ ] S8.3 RED: `extract.test.js`: `debtPrompt` includes debt names and history; `normaliseDebtExtraction` rejects a negative amount (needs correction), reports `missingFields`, flags a missing rate convention, caps charges at 6. Reqs: NDA-1, NDA-2. Pair: S8.4. Done: fails.
- [ ] S8.4 GREEN: `extract.js`. Pair: S8.3.
- [ ] S8.5 RED: `pending.test.js`: payload at most 1.5 KB (asserted), `callback_data` at most 64 bytes for `nia:pick:{debtId}` (at most 6), `nia:strat:`, `nia:conv:`, `nia:simpay`, `dedupeKey = debt:{pendingId}`. Reqs: NDA-4. Pair: S8.6. Done: fails.
- [ ] S8.6 GREEN: `pending.js`. Pair: S8.5.
- [ ] S8.7 RED: `preview.test.js`: pay preview (split, new balance, next installment, plan effect) from `planCommit`; create preview echoes `rateLabel` (2.1% MV -> about 28.3% EA) with usury and Ley 1555 notices that never block; a missing convention yields the `nia:conv` keyboard before any preview. Reqs: NDA-2, IRC-4. Pair: S8.8. Done: fails.
- [ ] S8.8 GREEN: `preview.js`. Pair: S8.7.
- [ ] S8.9 RED: `handler.test.js` (injected `{listRows, createRow, deleteRow, gemini, sendMessage, now, ids}`) + `replies.test.js` for the list reply and `clampTelegram(text, 4096)`: pay request shows a preview and writes nothing until confirm; invalid extraction asks for a correction and writes nothing; ambiguous debt sends the pick keyboard and writes nothing; an amount above the installment asks for a strategy before confirming; double Confirm -> one event, at most one cost row, second reply "ya registrado"; Telegram retry is idempotent; create writes debt `db{pendingId}` (409 = done) plus the `disbursement` event; list action. Reqs: NDA-1, NDA-3, NDA-4, NDA-5 (clamp). Pair: S8.10. Done: fails.
- [ ] S8.10 GREEN: `handler.js` (`handleDebt`, `confirmDebt`) and `replies.js` (list, `clampTelegram`). Pair: S8.9. Note: the design places `replies.js` in S9; the list reply and clamp are pulled forward because S8 includes the list action, and S9 extends the file.
- [ ] S8.11 RED: wiring tests: `intentFor` and `assistantPrompt` know `debt`; `handleTextOrReceipt` routes to `handleDebt`; `handleUpdate` routes `nia:pick:`, `nia:strat:`, `nia:conv:`, `nia:simpay`; `confirmPending` routes `pending.kind==='debt'`. Extend `scripts/package-nia.test.js`: with `index.js` importing `../../../packages/finance-core/index.js`, the bundle inlines the core (a core symbol appears in `dist-nia/index.js`), has no import resolving outside the archive, and still passes the smoke GET and the Node16 scan. Reqs: NDA-1, NIP-3. Pair: S8.12. Done: fails. Note: the tests may need a small named-export seam in `index.js`.
- [ ] S8.12 GREEN: `functions/nia/index.js` wiring per the design. Pair: S8.11. Done: green.
- [ ] S8.13 REFACTOR and verify: `npm test`, `npm run package:nia`, size checkpoint (valve: S8a/S8b). OA-4 optional upload.

## Phase S9: Nia simulate, advise, guardrails (about 580 lines)

- [ ] S9.1 RED: `guard.test.js`: `numbersIn` normalizes `.` and `,` separators and percent signs; a paraphrase with 42% not in `facts` returns `null`; a faithful paraphrase passes; over 4096 characters returns `null`. Reqs: NDA-6, DPA-3. Pair: S9.2. Done: fails.
- [ ] S9.2 GREEN: `guard.js`. Pair: S9.1.
- [ ] S9.3 RED: `cashflow.test.js`: 3 full months of average income and expense, margin, installment-to-income ratio, `tightMargin`, `higherRateDebt` with the gap rule; thresholds from `ADVICE_DEFAULTS`, overridden by env `DEBT_ADVICE_THRESHOLDS` JSON (invalid JSON falls back to defaults); paginated query helpers `queryGreaterEqual`, `queryLessThan`, `queryCursorAfter`. Reqs: NDA-5, DPA-2. Pair: S9.4. Done: fails.
- [ ] S9.4 GREEN: `cashflow.js` and the query helpers in `functions/nia/index.js`. Pair: S9.3.
- [ ] S9.5 RED: `replies.test.js` additions: a 360-row schedule shows only 3-6 rows (within the spec's 3-12) plus a web link, at most 4096 characters, a `nia:simpay` button; deterministic simulate and advise templates built from `facts`. Reqs: NDA-5. Pair: S9.6. Done: fails.
- [ ] S9.6 GREEN: `replies.js` simulate and advise templates. Pair: S9.5. Note: the web link uses the existing app URL env var if one exists, else a documented optional one.
- [ ] S9.7 RED: `handler.test.js` additions: simulate is read-only and `nia:simpay` creates a pending pay with the strategy; advise flows `compareStrategies` + `cashflowSignals` -> `advise` -> `buildFacts` -> Gemini paraphrase -> `guardParaphrase`; invented number -> template; Gemini failure -> template and the flow completes; `workspaceSnapshot` carries code-computed debt summaries and the model does no debt arithmetic. Reqs: NDA-5, NDA-6, DPA-2, DPA-3. Pair: S9.8. Done: fails.
- [ ] S9.8 GREEN: `handler.js` simulate/advise and the snapshot summary in `index.js`. Pair: S9.7.
- [ ] S9.9 Docs: `functions/nia/README.md` (debt intent and actions, `DEBT_ADVICE_THRESHOLDS`), `docs/setup.md` section 2 (new Nia env var), `docs/deploy.md` (redeploy the tarball after S9). Reqs: NDA-5, NIP-3. Pair: n/a (docs). Done: instructions verified once.
- [ ] S9.10 REFACTOR and final verification: `npm test`, `npm run build`, `npm run package:nia` and smoke GET, size checkpoint. Done: owner actions OA-3 and OA-4 reported as pending/done in the PR; ready for sdd-verify.

## Requirement index and traceability

| ID | Requirement (capability) | Tasks |
|---|---|---|
| NIP-1 | Nia tracked as plain files (nia-in-repo-packaging) | S0a.2, S0a.3, S0a.5, S0a.7 |
| NIP-2 | Destructive step is guarded (procedural: verified by PR evidence, not unit tests) | S0a.1, S0a.2, S0a.4 |
| NIP-3 | Deployable bundle script | S0b.1-S0b.7, S1.9, S8.11, S8.12, S9.9 |
| NIP-4 | Tarballs are not tracked | S0a.3, S0a.6, S0a.7, S0b.5 |
| IRC-1 | Rate stored as stated (interest-rate-conversion) | S1.5, S1.6 |
| IRC-2 | Round trip and invalid anticipated | S1.5, S1.6 |
| IRC-3 | Periodicities and date clamping | S1.3, S1.4 |
| IRC-4 | Usury notice is informational | S1.7, S1.8, S5.9, S8.7, S8.8 |
| DAS-1 | Amortization systems (debt-amortization-schedule) | S1.1, S1.2, S2.1-S2.6 |
| DAS-2 | Grace periods | S2.5, S2.6 |
| DAS-3 | Per-installment charges | S2.7, S2.8 |
| DAS-4 | Real cost summary | S2.7, S2.8 |
| DL-1 | Append-only debts and events (debt-ledger) | S3a.1, S3a.2, S3a.5, S3a.6, S4.5, S5.9, S6.7 |
| DL-2 | Deterministic projection | S3a.1, S3a.5, S3a.6 |
| DL-3 | Payment allocation | S3a.3, S3a.4 |
| DL-4 | Extra payments and rate changes | S3a.5, S3a.6 |
| DL-5 | Cost-only expense rows (void = delete row per AD7) | S3a.7, S3a.8, S4.1, S4.2, S4.5, S4.6, S4.8, S4.9, S6.1, S6.2, S6.5, S6.7 |
| DL-6 | Additive schema | S2.1, S4.3, S4.4, S4.10, OA-3 |
| DPA-1 | Strategy simulation (debt-prepayment-advice) | S3b.1, S3b.2, S6.9 |
| DPA-2 | Deterministic verdict | S3b.3, S3b.4, S6.9, S9.3, S9.7 |
| DPA-3 | Structured facts | S3b.3, S3b.4, S9.1, S9.7 |
| DPA-4 | Legal notice | S1.7, S1.8, S3b.3, S3b.4 |
| DWM-1 | Navigation and list (debt-web-management) | S5.1, S5.2, S5.5, S5.6, S5.11, S5.12 |
| DWM-2 | Create wizard | S2.1, S5.7-S5.10, S7.3, S7.4 |
| DWM-3 | Detail and plan | S6.3, S6.4 |
| DWM-4 | Record payment and void | S6.5-S6.8 |
| DWM-5 | Extra-payment simulator | S6.9, S6.10 |
| DWM-6 | Failure handling | S5.3, S5.5, S5.9, S6.5 |
| CCD-1 | Card as parent debt with tranches (credit-card-debt) | S7.1-S7.6 |
| CCD-2 | Interest rules | S7.1, S7.2 |
| CCD-3 | Minimum payment and fee | S7.1-S7.6 |
| CCD-4 | Statement-driven balance | S7.1, S7.2, S7.5, S7.6 |
| NDA-1 | Debt intent, extraction only (nia-debt-assistant) | S8.3, S8.4, S8.9-S8.12 |
| NDA-2 | Rate convention echo | S8.3, S8.7, S8.8 |
| NDA-3 | Debt selector | S8.1, S8.2, S8.9, S8.10 |
| NDA-4 | Exactly-once confirmation | S8.5, S8.6, S8.9, S8.10 |
| NDA-5 | Simulate and advise | S8.9, S8.10, S9.3-S9.8 |
| NDA-6 | Paraphrase guardrail | S9.1, S9.2, S9.7, S9.8 |

Coverage: 37 of 37 spec requirements map to at least one task. Threat-matrix rows: Git repository selection and Commit state -> S0a.2, S0a.3; Subprocess (packaging) -> S0b.3; rows marked N/A are omitted.

## Final verification checklist (end of S9, before sdd-verify)

- [ ] `npm test` and `npm run build` pass; `npm run package:nia` produces `functions/nia.tar.gz` that passes the smoke test.
- [ ] No tarball or `node_modules` tracked; `git ls-files -s functions/nia` has no 160000 entry.
- [ ] Owner actions OA-1 to OA-6 each marked done, skipped with reason, or pending in the PR descriptions.
