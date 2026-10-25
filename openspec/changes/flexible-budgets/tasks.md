# Tasks: Flexible Budgets (budget_lines, six money groups, web + Nia)

Strict TDD: every GREEN task is paired with a preceding RED task (RED -> GREEN -> REFACTOR). `npm test` = `vitest run`. Commits are work-unit commits (tests with code, docs with the behavior they explain), Conventional Commits, no AI attribution. The working tree holds unrelated uncommitted changes (`.claude/`, `scripts/spike-transactions.mjs`): always stage explicit paths, never `git add -A` or `commit -a`. Names (columns, result fields, warning codes, ids) come from the Naming table, Row ids and Edit plan sections of `design.md`; do not invent others.

Requirement IDs used below are defined in the traceability index at the end (BP = budget-plan, BC = budget-computation, BM = budget-migration, DM = dashboard-money-groups, NB = nia-budgets).

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (total) | about 4,150 (range 3,800-4,600), tests included |
| 400-line budget risk | Medium (S1c 380 and S6a 340 sit within 60 lines of the limit; no slice is expected to exceed it) |
| Chained PRs recommended | Yes (16 slices) |
| Suggested split | S1a -> S1b -> S1c -> S1d -> S2a -> S2b -> S3 -> S4 -> S5a -> S5b -> S6a -> S6b -> S7a -> S7b -> S8a -> S8b (see dependency graph) |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain (user decision 2026-10-25): tracker branch `feat/flexible-budgets`; slice PRs target the immediate previous slice branch (the first targets the tracker); only the tracker merges to `master`, after operator steps OP-1..OP-3 |
| Review budget | 400 changed lines per slice (session `review_budget_lines=400`, overrides the 800 in `openspec/config.yaml`) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Medium

Why a decision is needed even under `auto-chain`: the chain strategy is not chosen yet and PR base branches depend on it. There is also a rollout constraint: slices S4-S7 (web) must not be deployed before the operator has run `migrate:budgets --apply` (see Operator steps), which is independent of PR merge order. With `feature-branch-chain` the tracker branch must not be deployed until that is done; with `stacked-to-main` the merge of S4 onward effectively triggers the web deploy, so the owner must either run the migration before merging S4 or hold the deploy.

Per-slice estimate (additions + deletions, tests included):

| Slice | Est. lines | 400 risk | Overflow valve (pre-declared split) |
|---|---|---|---|
| S1a | 320 | Low | none |
| S1b | 230 | Low | none |
| S1c | 380 | Medium-High | S1c' = move debt actuals into `debtActual.js` (design note) |
| S1d | 120 | Low | none |
| S2a | 140 | Low | none |
| S2b | 320 | Low | none |
| S3 | 260 | Low | none |
| S4 | 330 | Medium | S4a = `appwrite.js` + `readOptional`; S4b = `linesMode` + shell memo |
| S5a | 250 | Low | none |
| S5b | 260 | Low | none |
| S6a | 340 | Medium | S6a-1 = `LineEditorDialog` UI; S6a-2 = save path and container wiring |
| S6b | 170 | Low | none |
| S7a | 230 | Low | none |
| S7b | 260 | Low | none |
| S8a | 320 | Low | none |
| S8b | 220 | Low | none |
| Total | about 4,150 | | |

Each slice ends with a size checkpoint task: run `git diff --stat` against the slice base; if additions + deletions exceed 400, split at the valve above before opening the PR.

### Suggested Work Units

PR bases depend on the chain strategy (pending). For `feature-branch-chain`: PR 1 base = tracker branch, PR N base = PR N-1 branch, tracker stays draft/no-merge. For `stacked-to-main`: each PR targets main after the previous one merges. Every child PR carries a dependency diagram with the current PR marked, plus start, end, prior dependencies, follow-up and out-of-scope notes (chained-pr skill). Do not mix strategies once chosen.

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| S1a | Core: groups, ids, line validation and resolution, legacy mapping | PR 1 | `npx vitest run packages/finance-core/test/budget/groups.test.js packages/finance-core/test/budget/ids.test.js packages/finance-core/test/budget/lines.test.js packages/finance-core/test/node16.test.js` | N/A: pure functions, no runtime boundary | Delete `packages/finance-core/src/budget/` and the barrel lines |
| S1b | Core: `planLineEdit` | PR 2 | `npx vitest run packages/finance-core/test/budget/edit.test.js` | N/A: pure | Delete `edit.js` and its test |
| S1c | Core: `computeBudgetMonth` | PR 3 | `npx vitest run packages/finance-core/test/budget/compute.test.js` | N/A: pure | Delete `compute.js` and its test |
| S1d | Core: `monthOutflows` | PR 4 | `npx vitest run packages/finance-core/test/budget/outflows.test.js` | N/A: pure | Delete `outflows.js` and its test |
| S2a | Schema: `budget_lines` in the migrate chain | PR 5 | `npx vitest run scripts/lib/budget-schema.test.js` | Operator runs `npm run migrate:appwrite` on a dev database twice; the second run changes nothing | Revert code; the table may stay unused |
| S2b | Migration planner (pure) | PR 6 | `npx vitest run scripts/lib/budget-migration.test.js` | N/A: pure planner | Delete `scripts/lib/budget-migration.mjs` and its test |
| S3 | Migration runner `migrate:budgets`, `COST_CATEGORY.kind = 'debt'` (web) | PR 7 | `npx vitest run scripts/migrate-budgets.test.js src/appwrite.test.js` | `npm run migrate:budgets` dry run against a dev database | Remove the runner and npm script; revert `COST_CATEGORY.kind` |
| S4 | Web data layer, `linesMode`, shell memo | PR 8 | `npx vitest run src/appwrite.test.js src/app` | `npm run dev` against a database with the table missing, then empty, then migrated | Revert; `budgets` still read by old code paths |
| S5a | BudgetContainer, header, legacy notice | PR 9 | `npx vitest run src/features/budget` | `npm run dev`: open Presupuesto | Revert the container and header files |
| S5b | Group sections and category rows | PR 10 | `npx vitest run src/features/budget` | `npm run dev`: compare figures with the dashboard | Revert `BudgetView` sections |
| S6a | LineEditorDialog and save path | PR 11 | `npx vitest run src/features/budget` | `npm run dev` against a dev database: set, remove, reload | Revert the dialog and save wiring; view stays read-only |
| S6b | AddCategoryDialog kinds, TransactionModal groups, copy-previous removal | PR 12 | `npx vitest run src/features/categories src/features/transactions src/features/budget` | `npm run dev`: create an investment category | Revert the three components |
| S7a | Dashboard data: monthly, cashflow, donut | PR 13 | `npx vitest run src/features/dashboard` | `npm run dev`: dashboard charts | Revert the three modules |
| S7b | KpiCards and DashboardView | PR 14 | `npx vitest run src/features/dashboard` | `npm run dev`: KPI cards, empty states | Revert KPI and view files |
| S8a | Nia budget module | PR 15 | `npx vitest run functions/nia` | N/A until S8b wiring | Revert `functions/nia/budget.js` |
| S8b | Nia wiring, kind enum, README | PR 16 | `npx vitest run functions/nia scripts/package-nia.test.js` | `npm run package:nia` and smoke GET; owner Telegram test on a dev bot | Revert wiring; redeploy the previous tarball |

### Dependency graph and parallelism

Hard dependencies (from `design.md`):

- S1a -> S1b, S1c, S2b; S1c -> S1d, S4; S2b -> S3; S4 -> S5a; S5a -> S5b, S6b; S1b + S5b -> S6a; S1d + S4 -> S7a -> S7b; S1b + S1c -> S8a -> S8b.
- S2a has no code dependency.

Independent in content (no shared files), so may be reordered or developed concurrently by different people, but each chain still has one writer and one PR in flight per branch:

- Track A (core): S1a -> {S1b, S1c} -> S1d
- Track B (schema and migration): S2a (independent of everything) -> S2b (after S1a) -> S3
- Track C (web): S4 -> S5a -> S5b -> S6a, S6b; S4 + S1d -> S7a -> S7b
- Track D (Nia): S8a -> S8b (after S1b and S1c)
- Parallel pairs once S1a is merged: S1b with S1c; S2b with S1c; S6b with S5b; S6a with S7a; S8a with web slices S5-S7.
- Sequential only: S1a before everything except S2a; S2b -> S3; S4 -> S5a -> S5b -> S6a; S7a -> S7b; S8a -> S8b.

Recommended linear merge order for a single writer (matches the dependency order): S1a, S1b, S1c, S1d, S2a, S2b, S3, S4, S5a, S5b, S6a, S6b, S7a, S7b, S8a, S8b. S2a should merge as early as possible so the operator can run step 1 below while code slices continue.

## Operator steps (manual, never automated by apply)

These are rollout actions performed by the owner against live Appwrite and the deploy targets. They are not code and are not executed by the apply phase. Order is mandatory (design Migration / Rollout, BM-9).

| ID | Action | When | Blocks |
|---|---|---|---|
| OP-1 | Run `npm run migrate:appwrite` (creates `budget_lines`; additive; run twice on a dev database first, second run must change nothing) | After S2a merges | OP-2, OP-3 |
| OP-2 | Run `npm run migrate:budgets` (dry run). Review: legacy rows read, lines to create, skips with reasons, seeded plan, duplicates, cost-category patches. Use `--no-seed` only if the seeded plan is rejected (open question Q3) | After S3 merges and OP-1 is done | OP-3 |
| OP-3 | Run `npm run migrate:budgets -- --apply`. Confirm a `backups/budget-migration-*.json` file exists. Re-run once: it must create zero lines and patch zero categories | After OP-2 review | OP-4, OP-6 |
| OP-4 | Deploy the web app containing S4-S7. Only after OP-3. The legacy fallback (AD15) covers any window where the table is missing or empty, but the deploy must not be ahead of the apply | After S4-S7 merge and OP-3 | OP-5 (soft) |
| OP-5 | Manual smoke check in the web app: Presupuesto shows migrated amounts, edit a line, scope Tú is read-only, dashboard KPIs match | After OP-4 | none |
| OP-6 | Run `npm run package:nia`, upload `functions/nia.tar.gz` to the Appwrite Function, then Telegram smoke test (set a budget, confirm "solo este mes", ask for the budget summary) | After S8b merges and OP-3 | none |
| OP-7 | Rollback if needed: revert the web and Nia deploys; `budgets` was never written, so the old behavior returns; revert cost-category kinds from the backup file. Line edits made after cut-over are not mirrored into `budgets` | On demand | none |

Open questions (do not block tasks; recorded from design): Q1 whether the reference base is enough for biweekly pay; Q3 whether the seed should be automatic (current default) or a one-click action.

## Phase S1a: Core groups, ids, lines (320 lines)

Files: `packages/finance-core/src/budget/{groups,ids,lines}.js`, `packages/finance-core/index.js` (barrel), `packages/finance-core/test/node16.test.js` (file list), tests under `packages/finance-core/test/budget/`.

- [x] S1a.1 RED: `test/budget/groups.test.js`: truth table for `groupOfKind` and `classifyTransaction`: unknown kind `"ocio"` -> `need`; missing category -> `need`; expense in an `income`-kind category -> `need`; `saving`/`investment`/`debt` kinds are not in `CONSUMPTION`; `type: 'transfer'` -> `null`; income type -> `income`; expense with `debtId` -> `debt` regardless of category kind; other types -> `null`; each transaction lands in exactly one group. Reqs: BP-1, BC-2. Scenarios: Legacy kind, New kinds are not consumption, Transfer ignored, Debt cost row, Unknown kind. Pair: S1a.2. Done: fails (module missing).
- [x] S1a.2 GREEN: `groups.js` (`GROUPS`, `CONSUMPTION`, `groupOfKind`, `classifyTransaction`). Pair: S1a.1. Done: green.
- [x] S1a.3 RED: `test/budget/ids.test.js`: FNV-1a 64-bit known vectors (empty string, `"a"`, a multi-byte UTF-8 string) as lowercase hex padded to 16; `targetKey` gives `category:{id}` / `group:{group}`; `lineIds.override`, `recurring`, `seeded` give `bo`/`br`/`bs` + `YYYYMM` + 16 hex (24 chars) and `lineIds.migrated` gives `bl{budgetId}`; a 36-character category id still yields an id of at most 36 characters; ids are deterministic. Reqs: BM-3. Scenarios: 1:1 mapping (id part), Plan seeded (id format). Pair: S1a.4. Done: fails.
- [x] S1a.4 GREEN: `ids.js` with 16-bit-limb arithmetic on Numbers (no BigInt literals). Pair: S1a.3. Done: green.
- [x] S1a.5 RED: `test/budget/lines.test.js`, part 1 validation: `validateLine` accepts a percent line (group `saving`, 2000 bp, `2026-11`, null); rejects unknown `targetType`, missing `targetId`, `percentBp` 10001, negative `amountMinor`, `toMonth` before `fromMonth`, group target `income`, category target of kind `income`; non-integer values rejected. Reqs: BP-2, BP-3. Scenarios: Valid percent line, Invalid lines, Income category rejected, Income group rejected. Pair: S1a.7. Done: fails.
- [x] S1a.6 RED: same file, part 2 resolution and legacy: `coversMonth`; `resolveLines` returns the winner per target key: override beats plan (800000 vs 950000 and `2026-11` back to 800000); same `fromMonth` one-month line wins; later plan supersedes (`2026-03` -> 500000, `2026-07` -> 600000); smaller `toMonth` wins between bounded lines, open-ended loses to bounded; last tie-break `bl2` over `bl1` in both input orders; shuffled input (seeded 200-case property test) gives an identical winner; tombstone (0) shadows the plan for `2026-10` and `2026-11` still resolves to 500000; no candidate -> `null`. `linesFromLegacyBudgets` maps each row to a one-month fixed line `bl{id}` and skips rows without month or with `plannedMinor` 0. Reqs: BP-4, BP-5, BM-8 (mapping part). Scenarios: Tombstone shadows the plan, Override beats plan, Same fromMonth tie, Later plan supersedes, Deterministic last tie-break. Pair: S1a.7. Done: fails.
- [x] S1a.7 GREEN: `lines.js` (`validateLine`, `coversMonth`, `resolveLines`, `linesFromLegacyBudgets`). Pair: S1a.5, S1a.6. Done: green.
- [x] S1a.8 RED then GREEN (one work unit): extend `test/node16.test.js` so the scan list includes `src/budget/*.js`; barrel test that `index.js` exports the budget public API and nothing private; then add the barrel exports. Reqs: BC-1 (Node 16). Pair: itself. Done: scan passes with no BigInt literals, `findLast`, `toSorted`, `structuredClone`.
- [x] S1a.9 REFACTOR and size checkpoint: `npm test`; `git diff --stat` <= 400.

## Phase S1b: planLineEdit (230 lines)

Depends on S1a. Files: `packages/finance-core/src/budget/edit.js`, barrel, `test/budget/edit.test.js`, node16 list.

- [x] S1b.1 RED: `test/budget/edit.test.js`, set rows: set/month with no one-month line creates `bo{M}{hash}`; set/month with a migrated one-month `blabc` updates `blabc` and creates nothing (no second one-month line); repeated set/month updates the same line; set/onward with a covering open-ended line from `2026-01` closes it at `2026-06` and upserts `br202607{hash}` (and `2026-03` still resolves to 500000 via `resolveLines`); set/onward with a line starting at M updates it in place; set/onward with none upserts `br{M}{hash}`; lines starting after M are kept untouched. Reqs: BP-6. Scenarios: Edit from this month on, Migrated one-month line reused, Repeated this-month edit. Pair: S1b.3. Done: fails.
- [x] S1b.2 RED: same file, remove rows: remove/month writes a one-month tombstone (update-or-create); remove/onward closes a line with `fromMonth < M` at M-1 (and `2026-07` has no limit, `2026-03` still 500000); remove/onward on a line starting at M updates it to an open-ended tombstone while an older closed line stays closed; remove/onward also zeroes an existing one-month line for (target, M); lines after M kept; nothing is ever deleted (plan has no delete operation). Reqs: BP-6. Scenarios: Remove from this month on, Remove a plan that starts this month, Remove only this month. Pair: S1b.3. Done: fails.
- [x] S1b.3 GREEN: `edit.js` `planLineEdit(lines, request)` returning `{creates, updates}`; every planned row passes `validateLine` first and an invalid plan returns an error and no rows (test: income target rejected, nothing planned); stamps `actorId` and `source`. Reqs: BP-3, BP-6. Pair: S1b.1, S1b.2. Done: green.
- [x] S1b.4 REFACTOR and size checkpoint: barrel export, node16 list, `npm test`.

## Phase S1c: computeBudgetMonth (380 lines)

Depends on S1a. Closest slice to the limit: if the checkpoint exceeds 400, split debt actuals into `debtActual.js` (S1c').

- [x] S1c.1 RED: `test/budget/compute.test.js`, income and percent: base `actual` (4,000,000 month income, 2000 bp -> 800,000); `reference` fallback (0 month income, 3,000,000 previous, 1000 bp -> 300,000); `none` (both 0, percent lines 0); rounding equals `roundUnit(3333333 * 1500 / 10000)` and is an integer; transfers do not change income or actuals; inputs are not mutated (deep-frozen inputs). Reqs: BC-1, BC-2, BC-3, BC-4. Scenarios: Real income present, Reference fallback, No income at all, Rounding, Transfer ignored. Pair: S1c.5. Done: fails.
- [x] S1c.2 RED: allocation and warnings: envelope wins (500,000 over 200,000 + 250,000); no envelope sums category lines (700,000); sub-limits exceeding envelope warn `sublimits_exceed_envelope` with `amountMinor` 100,000 and allocated stays 500,000; group `overBudget` only when allocated > 0 and actual > allocated; category `overBudget` only for non-zero line; tombstone category with actual 300,000 is not `overBudget`; zero group line means no envelope; income-targeting lines are ignored defensively; archived category line is ignored. Reqs: BC-5, BC-6. Scenarios: Envelope wins, No envelope, Sub-limits exceed envelope, Tombstone never over budget. Pair: S1c.5. Done: fails.
- [x] S1c.3 RED: Por asignar, totals, budget used: `porAsignarMinor` 4,000,000 - 500,000 - 1,500,000 = 2,000,000 (not double counted); negative -200,000 with `over_allocated`; `budgetUsed` planned 2,000,000 / spent 1,500,000 / ratio 0.75 with an unlimited `want` ignored; envelope adds planned 500,000 and spent 600,000; no limits -> ratio `null`; `consumptionMinor`, `outflowMinor`, `balanceMinor` (4,000,000 - (1,500,000 + 800,000 + 200,000 + 500,000) = 1,000,000); `savingsRateBp` and `debtShareBp` (20% savings -> 2000) and `null` when income is 0. Reqs: BC-7, BC-10. Scenarios: Not double counted, Over-allocated, Ratio, Envelope counts the whole group, No limits. Pair: S1c.5. Done: fails.
- [x] S1c.4 RED: debt actuals and scope: void-aware (payment 500,000 plus `void` -> 0); payment 300,000 + extra_payment 200,000 -> 500,000; debt cost row with `debtId` does not add (stays 500,000, `need` unaffected); debt-kind expense without `debtId` adds (580,000); `disbursement` and `charge` events ignored; events joined to an out-of-scope debt ignored; `debtEvents: null` -> fallback 120,000 and warning `debt_data_unavailable`; scoped percent (2,000,000 income, 2000 bp -> 400,000); fixed line in partial scope kept at 500,000 with `householdFixed: true`; card purchase plus card payment both count (consumption 100,000 and debt 100,000). Reqs: BC-8, BC-9, BC-11. Scenarios: Void-aware, Extra payment, No double count with cost rows, Debt-kind expense without debtId, Debt data unavailable, Scoped percent, Fixed line in partial scope, Documented limitation. Pair: S1c.5. Done: fails.
- [x] S1c.5 GREEN: `compute.js` `computeBudgetMonth` returning the exact shape in `design.md`; uses `classifyTransaction`, `resolveLines`, `roundUnit`; code comment documenting the card double counting limitation. Reqs: BC-1 to BC-11. Pair: S1c.1-S1c.4. Done: green.
- [x] S1c.6 REFACTOR and size checkpoint: barrel export, node16 list, `npm test`; split into `debtActual.js` if over 400.

## Phase S1d: monthOutflows (120 lines)

Depends on S1c.

- [x] S1d.1 RED: `test/budget/outflows.test.js`: per month `{income, consumption, saving, investment, debt, outflow}` for several months; `outflow` = consumption + saving + investment + debt; income minus outflow equals `balanceMinor` from `computeBudgetMonth` for the same data (consistency); transfers ignored; debt uses payment events when provided and the cost-row fallback when `debtEvents` is null. Reqs: DM-1, DM-4, DM-5. Scenarios: Consistency, Balance, Cashflow net. Pair: S1d.2. Done: fails.
- [x] S1d.2 GREEN: `outflows.js`, barrel export, node16 list. Pair: S1d.1. Done: green.
- [x] S1d.3 REFACTOR and size checkpoint: reuse the classifier and debt helper; `npm test`.

## Phase S2a: budget_lines schema (140 lines)

No code dependencies. Merge early (unblocks OP-1).

- [ ] S2a.1 RED: `scripts/lib/budget-schema.test.js`: snapshot of `BUDGET_TABLES` (`budget_lines` columns, types, sizes and required flags exactly as in the design table; `householdId` 36, `targetType` 16, `targetId` 36, `rule` 16, `fromMonth`/`toMonth` 7, `source` 16, `actorId` 36), indexes `by_household_from` and `by_household_target`, no unique index, permissions (table team read/create/update; no delete); `withBudgetSchema(tables, team)` appends the table, throws on redefinition (as `withLegalSchema` does), and leaves `budgets` untouched; chain `withBudgetSchema(withLegalSchema(withDebtSchema(base, team), team), team)` yields all prior tables unchanged. Reqs: BM-1. Scenarios: Idempotent schema (schema part). Pair: S2a.2. Done: fails.
- [ ] S2a.2 GREEN: `scripts/lib/budget-schema.mjs`; chain it in `scripts/migrate-appwrite.mjs` (the existing create-only `ensure*` loops give rerun idempotence). `node --check scripts/migrate-appwrite.mjs`. Never run against live Appwrite here (OP-1). Reqs: BM-1. Pair: S2a.1. Done: green.
- [ ] S2a.3 Docs: `docs/setup.md` section 3 (re-run `npm run migrate:appwrite`; additive; second run changes nothing), matching the file's existing language. Reqs: BM-1, BM-9. Pair: n/a (docs). Done: matches OP-1.
- [ ] S2a.4 REFACTOR and size checkpoint: `npm test`.

## Phase S2b: Migration planner (320 lines)

Depends on S1a. Files: `scripts/lib/budget-migration.mjs`, `scripts/lib/budget-migration.test.js`.

- [ ] S2b.1 RED: planner mapping: budget row `abc`, Mercado, `2026-09`, 900,000 -> creates `blabc` fixed 900,000 from/to `2026-09`; skipped with reasons: `plannedMinor` 0, missing month, missing category, `income`-kind category, `bl{id}` longer than 36; existing ids are skipped (listed in "already present"), never overwritten; summary counts (read, create, present, skipped). Reqs: BM-2, BM-3, BM-4. Scenarios: 1:1 mapping, Zero and income rows skipped, Re-run, Resume (10 of 40 existing -> only 30 created). Pair: S2b.4. Done: fails.
- [ ] S2b.2 RED: seeding: latest mapped month `2026-10` with 5 categories -> 5 open-ended fixed lines from `2026-11` with ids `bs202611{hash}`, keyed by category; two Mercado rows in `2026-10` (`a1` 700,000, `a2` 900,000) -> seed uses 900,000 and `duplicates` lists the other; no mapped rows -> no seed; `seed: false` -> `seeds` empty; seeds follow skip-if-exists; seeded section is separate in the result. Reqs: BM-5. Scenarios: Plan seeded, Duplicate rows in M. Pair: S2b.4. Done: fails.
- [ ] S2b.3 RED: cost category patches: every category matching "Costos financieros" ignoring case and accents (including archived) with kind not `debt` -> `{id, from, to: 'debt'}`; already `debt` -> none; several matches -> several patches; second plan after apply -> zero patches. Reqs: BM-7. Scenarios: Patch. Pair: S2b.4. Done: fails.
- [ ] S2b.4 GREEN: `planBudgetMigration({budgets, existingLineIds, categories, seed = true})` -> `{creates, seeds, skipped, duplicates, costCategoryPatches, summary}`; pure; reuses `linesFromLegacyBudgets`, `lineIds`, `validateLine`, and the resolution tie-break. Reqs: BM-2 to BM-5, BM-7. Pair: S2b.1-S2b.3. Done: green.
- [ ] S2b.5 REFACTOR and size checkpoint: `npm test`.

## Phase S3: Migration runner and cost-category kind (260 lines)

Depends on S2b. Files: `scripts/migrate-budgets.mjs`, `scripts/migrate-budgets.test.js`, `package.json`, `src/appwrite.js` (`COST_CATEGORY.kind`), `src/appwrite.test.js`.

- [ ] S3.1 RED: `scripts/migrate-budgets.test.js` with an injected fake `fetch`/client and temp backup dir (no live network): default run is a dry run and performs zero writes, printing read / create / present / skipped / seeded / duplicates / patches; `--apply` with `budget_lines` missing (404) aborts with the "Ejecuta npm run migrate:appwrite" message and zero writes; `--apply` writes the backup (`backups/budget-migration-*.json` with raw `budgets` rows, every matched cost category row before patch, existing line ids) before the first write; unwritable backup dir aborts with zero writes; rows are POSTed with deterministic ids and `409` counts as done; PATCH kinds happen after rows; second `--apply` creates zero lines and patches zero categories; interrupted run resumes; `--no-seed` omits seeds; row permissions team read/update at insert. Reqs: BM-2, BM-4, BM-6, BM-7, BM-8 (apply without table), BM-9. Scenarios: Dry run, Re-run, Resume, Backup failure, Apply without table, Patch. Pair: S3.2. Done: fails.
- [ ] S3.2 GREEN: `scripts/migrate-budgets.mjs` (same CLI shape and safeguards as `merge-categories.mjs`) and the `"migrate:budgets": "node scripts/migrate-budgets.mjs"` npm script. Never run against live Appwrite here (OP-2, OP-3). Pair: S3.1. Done: green; `node --check`.
- [ ] S3.3 RED then GREEN (one work unit): `src/appwrite.test.js` asserts the cost category created by `ensureCostCategory` has kind `debt` and that the folded-name lookup still matches existing categories of any kind; then change `COST_CATEGORY.kind` to `'debt'`. Reqs: BM-7. Scenarios: Patch (new categories). Pair: itself. Done: green.
- [ ] S3.4 Docs: `docs/setup.md` rollout section: OP-1 to OP-4 order, dry run before `--apply`, backup location, rollback via `budgets` plus the backup. Reqs: BM-9. Pair: n/a (docs). Done: steps match the Operator steps table.
- [ ] S3.5 REFACTOR and size checkpoint: `npm test`.

## Phase S4: Web data layer, linesMode, shell memo (330 lines)

Depends on S1c. Valve: S4a (data layer) / S4b (`linesMode` and shell).

- [ ] S4.1 RED: extend `src/appwrite.test.js` (`vi.mock('appwrite')`): `TABLES.budgetLines`; `readOptional` returns `{rows, status: 'ok'}`, `{rows: [], status: 'missing'}` on 404/table-not-found, `{rows: [], status: 'unavailable'}` on 500, and never throws; `saveBudgetLine(id, data)` creates with deterministic id, row permissions team read/update and no delete, treats `409` as an update; `updateBudgetLine`; `getWorkspace` also returns `budgetLines`, `debts`, `debtEvents` with their statuses and keeps existing fields; existing exports unchanged. Reqs: BM-8, NB-3 (shape parity), BP-6 (upsert by id). Scenarios: Table not yet created (data layer). Pair: S4.2. Done: fails.
- [ ] S4.2 GREEN: `src/appwrite.js` additions per the design. Pair: S4.1. Done: green.
- [ ] S4.3 RED: `linesMode` unit test (pure helper in the shell module or a small file): `budget_lines` missing + `budgets` rows -> `'legacy'`; present but empty + `budgets` rows -> `'legacy'`; present empty + no `budgets` -> `'lines'` and editing enabled; non-empty -> `'lines'`; unavailable status keeps editing disabled (`canEdit = scope === 'total' && linesMode === 'lines' && linesStatus === 'ok'`); in legacy mode lines come from `linesFromLegacyBudgets` and nothing throws; FinanceShell computes `computeBudgetMonth` once via `useMemo` from workspace data, 5-month history `previousMonthIncomeMinor`, `debtEvents` null when debt status is not `ok`. Reqs: BM-8, BC-1. Scenarios: Table not yet created, Table created but not migrated, New household. Pair: S4.4. Done: fails.
- [ ] S4.4 GREEN: `linesMode` and `canEdit`, shell memo `budgetMonth` passed down (props for BudgetContainer and DashboardView), removal of `categoryStats`, `budgetTotal`, `budgetedSpent`, `saveBudget`, `copyPreviousBudgets` from the shell; any existing tests that referenced them updated in the same commit. Pair: S4.3. Done: green; `npm run build` passes.
- [ ] S4.5 REFACTOR and verify: `npm test`, `npm run build`, size checkpoint (valve S4a/S4b).

## Phase S5a: BudgetContainer and header (250 lines)

Depends on S4. Files under `src/features/budget/`.

- [ ] S5a.1 RED: `BudgetContainer.test.jsx` and header test: container receives `budgetMonth`, `canEdit`, `linesMode`; shows the legacy notice "Los presupuestos se están migrando; la edición se habilita al terminar." in legacy mode and no edit controls; shows the "Referencia: {mes anterior}" badge when `base.source` is `reference` and a missing-income hint for `none`; header shows income base, Asignado, Por asignar (negative styled with the `over_allocated` indication); scope Tú/Pareja shows lines read-only with a note to switch to Hogar; `saveState` is not optimistic (idle -> saving -> idle/error with `readableError` and "Reintentar"). Reqs: BP-7, BM-8, BC-7. Scenarios: Edit blocked in personal scope, Table not yet created, Table created but not migrated, Over-allocated (display). Pair: S5a.2. Done: fails.
- [ ] S5a.2 GREEN: `BudgetContainer.jsx` (container, editor state shell, `onRefresh` hook-up) and `BudgetView` header. Pair: S5a.1. Done: green.
- [ ] S5a.3 REFACTOR and size checkpoint: `npm test`, `npm run build`.

## Phase S5b: Group sections and category rows (260 lines)

Depends on S5a.

- [ ] S5b.1 RED: `BudgetView.test.jsx`: five sections (need, want, saving, investment, debt) in order; category rows show planned, actual, remaining, a rule chip ("Fijo" or "x%"), a "Hogar" chip when `householdFixed`; `overBudget` rows styled as over; saving/investment overshoot styled as achieved not as over; tombstone rows show "Sin límite"; the group envelope row is distinguished from sub-limits and the `sublimits_exceed_envelope` warning is shown; `debt_data_unavailable` warning shown; help text mentions the credit-card double counting limitation; no copy-previous control. Reqs: BC-5, BC-6, BC-9, BC-11, BP-8. Scenarios: Fixed line in partial scope (display), Sub-limits exceed envelope (display), Documented limitation, Future month inherits. Pair: S5b.2. Done: fails.
- [ ] S5b.2 GREEN: `BudgetView.jsx` sections and rows. Pair: S5b.1. Done: green.
- [ ] S5b.3 REFACTOR and size checkpoint: `npm test`, `npm run build`.

## Phase S6a: LineEditorDialog and save path (340 lines)

Depends on S1b and S5b. Valve: S6a-1 (dialog) / S6a-2 (save path).

- [ ] S6a.1 RED: `LineEditorDialog.test.jsx` (jsdom + user-event): Fijo/Porcentaje toggle; value input; "Solo este mes"/"Desde este mes" choice; "Equivale a $X" preview computed from the base (`roundUnit`) and a no-base notice when `base.source` is `none`; "Quitar solo este mes" and "Quitar desde este mes" actions; income categories not offered; percent over 10000 bp blocked with an inline message; invalid input disables save. Reqs: BP-2, BP-3, BP-6. Scenarios: Valid percent line, Invalid lines, Income category rejected. Pair: S6a.2. Done: fails.
- [ ] S6a.2 GREEN: `LineEditorDialog.jsx` (Radix Dialog). Pair: S6a.1. Done: green.
- [ ] S6a.3 RED: container save tests (mock `saveBudgetLine`/`updateBudgetLine`): every action/span calls `planLineEdit` and writes the plan sequentially (close old line, then upsert new) with deterministic ids and `source: 'web'`; edit "desde este mes" over an open-ended `2026-01` line closes it at `2026-06` and opens `2026-07`; migrated `bl…` one-month line is updated not duplicated; invalid plan writes nothing; write error keeps the dialog open with `readableError` and "Reintentar", same ids on retry; `onRefresh` only after all writes resolve; editor unavailable when `canEdit` is false. Reqs: BP-6, BP-7. Scenarios: Edit from this month on, Remove from this month on, Remove only this month, Migrated one-month line reused, Repeated this-month edit. Pair: S6a.4. Done: fails.
- [ ] S6a.4 GREEN: save handler in `BudgetContainer.jsx`, dialog wiring from category rows. Pair: S6a.3. Done: green.
- [ ] S6a.5 REFACTOR and size checkpoint: `npm test`, `npm run build` (valve S6a-1/S6a-2).

## Phase S6b: Category kinds, transaction grouping, copy-previous removal (170 lines)

Depends on S5a.

- [ ] S6b.1 RED: `AddCategoryDialog` test: kind select offers Inversión and Deuda besides existing kinds and stores `investment` / `debt`; `TransactionModal` test: expense categories grouped by group through `optgroup` using `groupOfKind`; test asserting no "copy previous month" control or `copyPreviousBudgets` reference remains in the budget feature. Reqs: BP-1, BP-8. Scenarios: Future month inherits, New kinds are not consumption. Pair: S6b.2. Done: fails.
- [ ] S6b.2 GREEN: `AddCategoryDialog`, `TransactionModal`, removal of the copy-previous UI and dead code. Pair: S6b.1. Done: green.
- [ ] S6b.3 REFACTOR and size checkpoint: `npm test`, `npm run build`.

## Phase S7a: Dashboard data modules (230 lines)

Depends on S1d and S4.

- [ ] S7a.1 RED: `monthly` tests: `aggregateMonthlyTotals` and month deltas delegate to `monthOutflows` (savings do not count as Gastos; delta uses the same definition on both months); `cashflow` tests: plots income against outflow per period, net equals Balance (1,000,000 for the example), transfers ignored; `categoryDonut` tests: consumption categories only, saving/investment/debt excluded. Reqs: DM-1, DM-2, DM-4, DM-5. Scenarios: Consistency, Savings not spending, Balance, Cashflow net. Pair: S7a.2. Done: fails.
- [ ] S7a.2 GREEN: `monthly.js`, `cashflow.js`, `categoryDonut` changes. Pair: S7a.1. Done: green.
- [ ] S7a.3 REFACTOR and size checkpoint: `npm test`, `npm run build`.

## Phase S7b: KpiCards and DashboardView (260 lines)

Depends on S7a.

- [ ] S7b.1 RED: `KpiCards.test.jsx`: Balance, Ingresos, Gastos labeled as consumption ("Gastos (consumo)"), Ahorro e inversión (saving + investment), Tasa de ahorro 20% for the 4,000,000 example, Deudas (% of income), Presupuesto usado shows 50% for the unlimited-spending example and the Por asignar subline (negative with over-allocated indication when `over_allocated`); empty states, never NaN or Infinity, for savings rate and debt share with income 0 and for Presupuesto usado when the ratio is null; reference/missing income base is indicated on income-based KPIs; help text mentions the credit-card double counting and that Balance includes ahorro, inversión y pagos de deuda; `DashboardView` receives `budgetMonth` and shows the same figures as BudgetView. Reqs: DM-2, DM-3, DM-4, DM-6, BC-10, BC-11. Scenarios: Presupuesto usado ignores unlimited spending, Savings rate, Zero income, Label, Documented limitation. Pair: S7b.2. Done: fails.
- [ ] S7b.2 GREEN: `KpiCards`, `DashboardView`, shell wiring of `budgetMonth`. Pair: S7b.1. Done: green.
- [ ] S7b.3 REFACTOR and verify: `npm test`, `npm run build`, size checkpoint. Done: web slices S4-S7 complete; OP-4 may proceed only after OP-3.

## Phase S8a: Nia budget module (320 lines)

Depends on S1b and S1c. Files: `functions/nia/budget.js` and tests.

- [ ] S8a.1 RED: `functions/nia/budget.test.js` snapshot inputs: loads `budget_lines` (paginated), `budgets`, `debts`, `debt_events` and transactions of M and M-1 through an injected `listRows`; applies the legacy fallback (table missing, or empty with legacy rows) using `linesFromLegacyBudgets`; empty table with no legacy rows is `lines` mode; failed debt read passes `debtEvents: null` and surfaces `debt_data_unavailable`; result equals `computeBudgetMonth` output for the same inputs (parity with the web: Por asignar and group actuals). Reqs: NB-3, BM-8, BC-1. Scenarios: Matching numbers, Table missing. Pair: S8a.4. Done: fails.
- [ ] S8a.2 RED: preview and plan: set budget "Mercado 900 thousand" builds a preview naming Mercado, 900000 and "solo este mes" and writes nothing; confirmation applies `planLineEdit({span: 'month', action: 'set'})` and creates exactly one `bo` line, leaving the open-ended plan unchanged; a second set updates the existing one-month line (any id) with no duplicate; delete flow uses `action: 'remove'` and writes a one-month tombstone (amount 0) leaving the recurring line unchanged; `income`-kind category rejected; legacy mode refuses writes with the migration-pending message; `budgets` is never written. Reqs: NB-1. Scenarios: Set budget, Repeat, Preview before write, Delete this month. Pair: S8a.4. Done: fails.
- [ ] S8a.3 RED: reply figures: replies receive code-computed allocated, actual and Por asignar from `computeBudgetMonth` and the model does no budget arithmetic. Reqs: NB-3. Scenarios: Matching numbers. Pair: S8a.4. Done: fails.
- [ ] S8a.4 GREEN: `functions/nia/budget.js` (Node 16-safe; imports core through the existing in-repo path). Pair: S8a.1-S8a.3. Done: green.
- [ ] S8a.5 REFACTOR and size checkpoint: `npm test`.

## Phase S8b: Nia wiring, kind enum, README (220 lines)

Depends on S8a.

- [ ] S8b.1 RED: wiring tests in `functions/nia` (injected deps as in existing handler tests): the budget intent routes to the new module and the pending/confirm flow carries the "solo este mes" preview; the kind enum in extraction accepts `investment` and does not accept or offer `debt`; unknown legacy kinds still read as `need`; creating a category of kind investment stores `investment`; `COST_CATEGORY.kind` in `functions/nia/debt/handler.js` is `'debt'`; `scripts/package-nia.test.js` still builds and passes the Node 16 scan and smoke GET with the budget module bundled. Reqs: NB-1, NB-2, NB-4, BM-7. Scenarios: New category, Cost row, Set budget (wiring). Pair: S8b.2. Done: fails.
- [ ] S8b.2 GREEN: `functions/nia/index.js` wiring, kind enum, `COST_CATEGORY.kind = 'debt'`. Pair: S8b.1. Done: green.
- [ ] S8b.3 Docs: `functions/nia/README.md` documents `budget_lines`, "solo este mes" semantics, legacy refusal, and the deploy order (after `migrate:budgets --apply`). Reqs: NB-1, NB-3, BM-9. Pair: n/a (docs). Done: matches OP-6.
- [ ] S8b.4 REFACTOR and final verification: `npm test`, `npm run build`, `npm run package:nia` and smoke GET, size checkpoint. Done: OP-1 to OP-7 reported as done/pending in PR descriptions; ready for sdd-verify.

## Requirement index and traceability

| ID | Requirement (capability) | Tasks |
|---|---|---|
| BP-1 | Money groups (budget-plan) | S1a.1, S1a.2, S6b.1, S6b.2 |
| BP-2 | Budget line shape | S1a.5, S1a.7, S6a.1, S6a.2 |
| BP-3 | No income targets | S1a.5, S1a.7, S1b.3, S6a.1, S6a.2 |
| BP-4 | Zero-amount lines are tombstones | S1a.6, S1a.7 |
| BP-5 | Line resolution per target and month | S1a.6, S1a.7 |
| BP-6 | Editing preserves history | S1b.1-S1b.3, S4.1, S6a.1-S6a.4 |
| BP-7 | Hogar-only editing | S5a.1, S5a.2, S6a.3, S6a.4 |
| BP-8 | Copy-previous removal | S5b.1, S5b.2, S6b.1, S6b.2 |
| BC-1 | Pure shared computation (budget-computation) | S1a.8, S1c.1, S1c.5, S4.3, S4.4, S8a.1 |
| BC-2 | Transaction classification | S1a.1, S1a.2, S1c.1 |
| BC-3 | Income base for percent lines | S1c.1, S1c.5 |
| BC-4 | Percent rounding | S1c.1, S1c.5 |
| BC-5 | Allocation per group | S1c.2, S1c.5, S5b.1, S5b.2 |
| BC-6 | Over-envelope warnings | S1c.2, S1c.5, S5b.1, S5b.2 |
| BC-7 | Por asignar | S1c.3, S1c.5, S5a.1, S5a.2 |
| BC-8 | Debt actuals | S1c.4, S1c.5, S1d.1 |
| BC-9 | Scope behavior | S1c.4, S1c.5, S5b.1, S5b.2 |
| BC-10 | Budget used and totals | S1c.3, S1c.5, S7b.1, S7b.2 |
| BC-11 | Known limitation, credit-card double counting | S1c.4, S1c.5, S5b.1, S7b.1 |
| BM-1 | Budget lines schema (budget-migration) | S2a.1-S2a.3 |
| BM-2 | Dry run by default | S2b.1, S2b.4, S3.1, S3.2 |
| BM-3 | Row mapping and deterministic ids | S1a.3, S1a.4, S2b.1, S2b.4 |
| BM-4 | Idempotent apply | S2b.1, S3.1, S3.2 |
| BM-5 | Plan seeding | S2b.2, S2b.4 |
| BM-6 | Backup before writes | S3.1, S3.2 |
| BM-7 | Cost category kind patch | S2b.3, S3.1-S3.3, S8b.1, S8b.2 |
| BM-8 | Legacy read-only fallback | S1a.6, S3.1, S4.1, S4.3, S4.4, S5a.1, S8a.1 |
| BM-9 | Rollout order | S2a.3, S3.4, S8b.3, OP-1 to OP-7 (procedural, verified by PR evidence, not unit tests) |
| DM-1 | One classifier everywhere (dashboard-money-groups) | S1d.1, S7a.1, S7a.2 |
| DM-2 | Gastos is consumption only | S7a.1, S7b.1 |
| DM-3 | New KPIs | S7b.1, S7b.2 |
| DM-4 | Balance | S1d.1, S7a.1, S7b.1 |
| DM-5 | Donut and cashflow | S1d.1, S7a.1, S7a.2 |
| DM-6 | Labels and help | S7b.1, S7b.2 |
| NB-1 | Budget commands write this-month-only lines (nia-budgets) | S8a.2, S8a.4, S8b.1-S8b.3 |
| NB-2 | Investment kind | S8b.1, S8b.2 |
| NB-3 | Snapshot reads lines | S4.1, S8a.1, S8a.3, S8a.4, S8b.3 |
| NB-4 | Debt cost category | S8b.1, S8b.2 |

Coverage: 38 of 38 spec requirements map to at least one task. Threat Matrix: N/A (design): the runner is a plain `fetch` script with the same safeguards as `merge-categories.mjs`; no routing, shell, subprocess or VCS boundary.

## Final verification checklist (end of S8b, before sdd-verify)

- [ ] `npm test` and `npm run build` pass; `npm run package:nia` produces `functions/nia.tar.gz` that passes the smoke test and the Node 16 scan.
- [ ] `packages/finance-core/test/node16.test.js` lists every new budget file and passes.
- [ ] `budgets` table is never written by web or Nia code (grep shows only reads and the migration backup).
- [ ] No slice PR exceeded 400 changed lines, or the overflow valve was used and noted in the PR.
- [ ] Operator steps OP-1 to OP-7 each marked done, skipped with reason, or pending in the PR descriptions.
