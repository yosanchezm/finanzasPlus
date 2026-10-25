# Apply progress: flexible-budgets

Mode: Strict TDD. Engram: unavailable in this executor (no mem_* tools); progress persisted here only.

## S1a (branch feat/fb-s1a-core): S1a.1-S1a.9 complete

| Task | Test file | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|
| S1a.1/2 | test/budget/groups.test.js | module missing | 7 pass | Map and object lookup, debtId, transfer, unknown kinds | clean |
| S1a.3/4 | test/budget/ids.test.js | module missing | 6 pass | 5 vectors (BigInt oracle run offline), 36-char id | clean |
| S1a.5-7 | test/budget/lines.test.js | module missing | 23 pass | 11 invalid-line rows, 200-case shuffle property | clean |
| S1a.8 | test/node16.test.js | 2 barrel tests failed (86 vs 97 keys) | pass after barrel lines | n/a | n/a |
| S1a.9 | npm test | n/a | 166 files / 2956 tests pass | n/a | comments trimmed to fit 400 |

## Size
New files 373 lines (src 159, tests 230 incl. none else) + tracked diff 21 = 394 (<= 400).

## Work Unit Evidence
- Focused: `npx vitest run packages/finance-core/test/budget packages/finance-core/test/node16.test.js` green.
- Runtime harness: N/A (pure functions).
- Rollback: delete `packages/finance-core/src/budget/`, `test/budget/`, 3 barrel lines, node16 additions.

## Decisions
- validateLine returns `{ok}` / `{ok:false, code}`; unknown category is not rejected (callers report it).
- `categoryOf` (Map or plain object lookup) lives in groups.js and is not exported from the barrel.
- Id helpers take `(target, 'YYYY-MM')`; `migrated(budgetId)`.
- linesFromLegacyBudgets also skips rows without categoryId; sets `actorId`/`source` to `migration`.

## S1b (branch feat/fb-s1b-line-edit): S1b.1-S1b.4 complete

| Task | Test file | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|
| S1b.1/2 | test/budget/edit.test.js | module missing | 16 pass | set/remove x month/onward, migrated `bl` reuse, year boundary, percent rule, later lines kept, existing br row becomes update | clean |
| S1b.3 | same | n/a | income target and invalid percent plan nothing | n/a | n/a |
| S1b.4 | npm test | n/a | 167 files / 2972 tests pass (one unrelated web timeout on first run, passed on re-run) | n/a | barrel + node16 list |

## Size
209 lines (src 64, test 141, tracked diff 4).

## Work Unit Evidence
- Focused: `npx vitest run packages/finance-core/test/budget/edit.test.js` green. Runtime harness: N/A (pure).
- Rollback: delete `edit.js`, `edit.test.js`, the barrel line and node16 additions.

## Decisions
- `planLineEdit(lines, {target, rule, value, month, span, action, actorId, source, categoriesById})` returns `{ok:true, creates, updates}` or `{ok:false, code, creates:[], updates:[]}`; rows are `{id, data}` with full row data (no `$` fields).
- Closing a line when the target is also in `lines` uses the latest open-ended line with `fromMonth <= M` as "covering".
- set/onward leaves an existing one-month line for M untouched (per Edit plan table), so it still shadows month M; callers (S6a) may want to warn.

## S1c (branch feat/fb-s1c-compute): S1c.1-S1c.6 complete

| Task | Test file | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|
| S1c.1-4 | test/budget/compute.test.js | module missing (suite failed to load) | 17 pass after `compute.js`; 2 fixture fixes (extra_payment and charge need valid payloads) | base actual/reference/none, envelope vs sub-limits, tombstones, void-aware, scope, unreadable events | clean |
| S1c.5 | same | n/a | 18 pass with the unreadable-events case | n/a | n/a |
| S1c.6 | npm test | barrel key-list test failed before the export line | 168 files / 2990 tests pass | n/a | barrel + node16 list |

## Size
270 lines (src 102, test 165, tracked diff 3). No split into `debtActual.js` needed.

## Work Unit Evidence
- Focused: `npx vitest run packages/finance-core/test/budget/compute.test.js` green. Runtime harness: N/A (pure).
- Rollback: delete `compute.js`, `compute.test.js`, the barrel line and the node16 additions.

## Decisions
- `transactions` must already be the month's rows (not filtered by date inside); callers pass `previousMonthIncomeMinor` separately. Debt events are filtered by `effectiveOn` month.
- Debt events are read with `activeEvents`; any unreadable event makes debt data unavailable (cost-row fallback plus `debt_data_unavailable`).
- `totals.incomeMinor` is the real income; Por asignar uses `base.incomeMinor` (may be the reference). Rates use real income and `savingsRateBp` = (saving + investment) / income.
- `groups[g].envelope` is null when absent or zero; `remainingMinor` is 0 when the limit is 0. `householdFixed` is true only for non-zero fixed lines when `scoped`.
- Group lines on `income`, income-kind categories and archived categories are ignored; warnings carry `group`/`amountMinor` only where the design lists them.

## S1d (branch feat/fb-s1d-outflows): S1d.1-S1d.3 complete

| Task | Test file | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|
| S1d.1/2 | test/budget/outflows.test.js | module missing | 6 pass | empty months, all groups, transfers, consistency with computeBudgetMonth, void/scope/charge, cost-row replacement, null-events fallback | `debtPayments` exported from compute.js and reused (no duplicated classifier or debt logic) |
| S1d.2 | test/node16.test.js | barrel key list failed before export | pass | n/a | barrel + node16 list |
| S1d.3 | npm test | n/a | 169 files / 2996 tests pass (one unrelated web timeout on first run, passed on re-run) | n/a | clean |

## Size
Approx 130 lines (src 38, test 77, tracked diff 5 incl. barrel and node16).

## Work Unit Evidence
- Focused: `npx vitest run packages/finance-core/test/budget/outflows.test.js` green. Runtime harness: N/A (pure).
- Rollback: delete `outflows.js`, `outflows.test.js`, the barrel line, the node16 additions; drop `export` on `debtPayments`.

## Decisions
- Signature `monthOutflows(transactions, debtEvents, debts, months, categoriesById, { inScope, monthOf })`; transactions are bucketed by `occurredAt.slice(0, 7)` unless `monthOf` is given (S7a can pass a local-time month key to match `monthKeyOf`).
- Same debt rule as computeBudgetMonth: payments replace cost rows with a `debtId`, kind-only rows always add, and the cost rows are the fallback when `debtEvents` is null or unreadable.
- `debtPayments` is exported from compute.js but not from the package barrel.

## S2a (branch feat/fb-s2a-schema): S2a.1-S2a.4 complete

| Task | Test file | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|
| S2a.1/2 | scripts/lib/budget-schema.test.js | module missing | 12 pass | columns/sizes/required snapshot, indexes (no unique), permissions, redefinition throws (also second merge), no mutation, full chain keeps prior tables, static checks of migrate-appwrite.mjs | clean |
| S2a.3 | docs/setup.md | n/a | section added, table count now thirteen | n/a | n/a |
| S2a.4 | npm test | n/a | 170 files / 3008 tests pass | n/a | n/a |

## Size
About 181 lines (src 53, test 106 incl. blanks, tracked diff 22 incl. docs).

## Work Unit Evidence
- Focused: `npx vitest run scripts/lib/budget-schema.test.js` green; `node --check scripts/migrate-appwrite.mjs` ok; existing legal/debt schema tests still pass. Runtime harness: N/A here; the migration was never run (OP-1 is the operator's step).
- Rollback: delete `budget-schema.mjs` and its test, revert the import and chain line in `migrate-appwrite.mjs` and the docs section; the table may stay unused.

## Decisions
- Test file is `.test.js` as the task says (legal uses `.test.mjs`); vitest picks up both.
- Table display name `Líneas de presupuesto`, matching the Spanish names of the other tables.
- Import placed alphabetically; the legal test's chain regex still matches the nested call.

## S2b (branch feat/fb-s2b-migration-planner): S2b.1-S2b.5 complete

| Task | Test file | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|
| S2b.1 | scripts/lib/budget-migration.test.js | module missing (suite failed to load) | 10 pass after `budget-migration.mjs` | 1:1 mapping, six skip reasons, existing ids listed as present (resume) | clean |
| S2b.2 | same | same | same | seed from M+1, December rollover, tie-break duplicates, no rows / `seed: false`, seed skip-if-exists | clean |
| S2b.3 | same | same | same | case/accent/archived matches, already `debt` -> none, several patches | clean |
| S2b.4/5 | npm test | n/a | 171 files / 3018 tests pass | n/a | n/a |

## Size
244 lines (src 124, test 120). No tracked-file changes.

## Work Unit Evidence
- Focused: `npx vitest run scripts/lib/budget-migration.test.js` green (10 tests). Runtime harness: N/A (pure planner).
- Rollback: delete `scripts/lib/budget-migration.mjs` and its test.

## Decisions
- Result adds `present` (ids already in `budget_lines`, mapped rows and seeds) next to the designed keys; `summary` = `{read, create, present, skipped, seed, duplicates, patches}`.
- `skipped` entries are `{id, reason}` with reasons `missing_month`, `zero_amount`, `missing_category`, `income_category`, `id_too_long`, `invalid_line:{code}` (from `validateLine`, e.g. a non-integer amount).
- `creates` holds only the 1:1 lines; `seeds` is separate. Lines carry `householdId` from the source row; the runner adds team permissions.
- Seeds and duplicates come from mapped rows (after skips), independent of whether their ids already exist. `duplicates` entries: `{targetId, month, keptId, ignoredIds}`.

## S3 (branch feat/fb-s3-migration-runner): S3.1-S3.5 complete

| Task | Test file | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|
| S3.1/2 | scripts/migrate-budgets.test.js | module missing (suite failed to load) | 9 pass after `migrate-budgets.mjs` | dry run with zero writes and full report, apply without table (aborts, zero writes, dry run still reports), backup content and order, backup failure, re-run no-op, interrupted resume, 409 as done, `--no-seed`, missing env | trimmed to fit the 400-line budget |
| S3.3 | src/appwrite.test.js | `kind` expected `debt`, got `need` | 51 pass after `COST_CATEGORY.kind = 'debt'` | lookup test now uses an existing `need` category and still matches | n/a |
| S3.4 | docs/setup.md | n/a | rollout steps added under the flexible budgets section | n/a | n/a |
| S3.5 | npm test | n/a | 172 files / 3027 tests pass | n/a | n/a |

## Size
Exactly 400 (runner 213 + test 165 new, tracked diff 22 incl. docs). Trimmed comments and tests to stay within budget.

## Work Unit Evidence
- Focused: `npx vitest run scripts/migrate-budgets.test.js src/appwrite.test.js` green; `node --check scripts/migrate-budgets.mjs` ok. Runtime harness: injected fake fetch only; the runner was NEVER executed against Appwrite (OP-2, OP-3 are the operator's).
- Rollback: delete the runner and its test, remove the `migrate:budgets` script and the docs steps, revert `COST_CATEGORY.kind` to `need`.

## Decisions
- `runMigration({argv, env, fetch, backupDir, log, error})` returns the exit code and is exported; the script auto-runs only when invoked directly (`import.meta.url` check).
- npm script uses `node --env-file=.env scripts/migrate-budgets.mjs` like its siblings (the task text omitted `--env-file`).
- Dry run does not need the team id; `--apply` requires it for row permissions `read`/`update` on `team:{id}`.
- Dry run with a missing `budget_lines` warns and continues with no existing ids; `--apply` aborts before the backup.
- Backup JSON: `{createdAt, databaseId, budgets, costCategories, existingLineIds, plan}`. Nia's `COST_CATEGORY` stays `need` until S8b.

## S4 (branch feat/fb-s4-web-data): S4.1-S4.5 complete

| Task | Test file | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|
| S4.1/2 | src/appwrite.test.js | 10 failures (readOptional, saveBudgetLine, updateBudgetLine, getWorkspace keys, TABLES missing) | 57 pass | ok/missing/unavailable (404, 500, network error), create vs 409 update vs non-409 rethrow, getWorkspace with a missing and a failing optional table | reused `hasStatus` for the 404 rule |
| S4.3/4 | src/app/budgetMonth.test.js | module missing | 12 pass | linesMode: missing, empty+legacy, empty+none, non-empty, absent field, unavailable; canEdit four cases; reference income previous month only and scoped; null debt events on non-ok | n/a |
| S4.5 | npm test, npm run build | n/a | 3045 tests pass (173 files); build ok | n/a | n/a |

## Size
About 334 lines (tracked diff 186 incl. deletions, new files 148).

## Work Unit Evidence
- Focused: `npx vitest run src/appwrite.test.js src/app` green. Runtime harness: N/A (no live Appwrite by rule); `npm run build` passes.
- Rollback: revert the S4 commit; `budgets` is untouched and still read.

## Decisions
- `getWorkspace` adds `budgetLines`, `debts`, `debtEvents`, each `{rows, status}`; existing fields unchanged. `permissions.budgetLineRow()` = team read + update.
- New `src/app/budgetMonth.js`: `resolveBudgetLines`, `canEditBudget`, `buildBudgetMonth`, `legacyDashboardProps`. An unavailable table is treated as legacy (lines from `budgets`), editing off.
- Debt events are null unless both `debts` and `debt_events` reads are ok. Reference income = previous month income rows of the 5-month history, scope filtered.
- Interim bridge until S5/S7: the shell derives the old `budget`, `categoryStats` and view `budgets` props from `budgetMonth` (`legacyDashboardProps`); the old BudgetView editor gets a paused handler (notify, no write) so `budgets` is never written. `upsertBudget` stays exported in appwrite.js but is unused by the shell. `budgetMonth`, `canEdit`, `linesMode` are already passed to BudgetView (ignored until S5a).

## S5a (branch feat/fb-s5a-budget-container): S5a.1-S5a.3 complete

| Task | Test file | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|
| S5a.1/2 | src/features/budget/BudgetHeader.test.jsx | module missing | 7 pass | actual/reference/none sources, over-allocated styling, legacy notice, personal scope note, no notice in Hogar | n/a |
| S5a.1/2 | src/features/budget/BudgetContainer.test.jsx | module missing | 4 pass | saving -> refresh -> idle (not optimistic), error with `readableError` and "Reintentar" repeating the same write, legacy mode, canEdit passthrough | n/a |
| S5a.2 | src/features/budget/BudgetView.test.jsx | 2 failures (header slot, read-only) | 20 pass | canEdit false vs true | `locked` threaded through the old row hook |
| S5a.3 | npm test, npm run build | n/a | 175 files / 3059 tests pass; build ok | n/a | n/a |

## Size
About 278 lines (tracked diff 47, new files 231).

## Work Unit Evidence
- Focused: `npx vitest run src/features/budget` green (37 tests). Runtime harness: N/A (no live Appwrite by rule); `npm run build` passes.
- Rollback: revert the S5a commit (delete `BudgetContainer.jsx`, `BudgetHeader.jsx`; shell lazy-imports `BudgetView` again).

## Decisions
- `BudgetContainer` owns `saveState` and exposes `onCommit(write)` to the view (write -> `onRefresh` -> idle; failure keeps the error and throws so the caller can react). "Reintentar" re-runs the last write. The S6a dialog will call `onCommit` with its `planLineEdit` writes.
- The header and the error banner are passed to `BudgetView` through a `header` slot; `BudgetHeader` is a separate presentational component.
- `BudgetView` takes `canEdit` (default true): when false, the old limit fields are read-only and the copy-previous action is hidden. The paused handler and the legacy BudgetView props stay in the shell until S5b/S6a replace the body.
- Legacy notice wins over the personal-scope note. Shell passes `scope` and `onRefresh={refreshInPlace}`.

## S5b (branch feat/fb-s5b-group-sections): S5b.1-S5b.3 complete

| Task | Test file | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|
| S5b.1/2 | src/features/budget/BudgetView.test.jsx | 17 of 17 failed (old body crashed on the missing `categories`/`budgets` props) | 34 pass in `src/features/budget` | five ordered groups; Fijo / x % / Hogar chips; Excedido vs Meta superada (saving); Sin límite for no line and for a removed (amount 0) line; envelope vs sub-limits warning scoped to its group; debt_data_unavailable; credit-card limitation note; no copy control or inputs; edit hook present only with `canEdit` and `onEditLine`; phone cards | single `rowState` shared by table row and card |
| S5b.3 | npm test, npm run build | n/a | 3056 tests pass; build ok | n/a | n/a |

## Size
OVER the 400 budget: tracked diff 298 additions + 435 deletions (about 733). Almost all deletions are the replaced limit editor (hooks, inputs, copy-previous, confirm dialog) and its tests; new code is about 298 lines. No pre-declared valve exists for S5b, and the body swap cannot be split without leaving a broken view.

## Work Unit Evidence
- Focused: `npx vitest run src/features/budget` green. Runtime harness: N/A (no live Appwrite by rule); `npm run build` passes.
- Rollback: revert the S5b commit (restores the old body and the paused handler in the shell).

## Decisions
- `BudgetView` now reads `budgetMonth` (+ `allCategories` for icons); props `categories`, `budgets`, `onSave`, `onCopyPrevious` are gone. Shell no longer passes them nor defines `budgetEditingPaused`; `legacyDashboardProps` still returns `budgets` (dead field, drops in S7).
- Summary card now uses `totals.budgetUsed` (Planeado/Gastado/Disponible); the old "Categorías excedidas" count and "Gasto sin límite" line were dropped.
- Saving and investment overshoot shows "Meta superada" and "+ $ X" (not danger); debt overshoot is styled as over.
- Edit hook: `onEditLine({ targetType, targetId })`, rendered as pencil buttons (44px on phones) only when `canEdit` and a handler exist; S6a wires it from the container. Group buttons target the group envelope.
- Copy-previous removed from the view; `ConfirmDialog`/`Button` imports removed.

## S6a (branch feat/fb-s6a-line-editor): S6a.1-S6a.5 complete

| Task | Test file | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|
| S6a.1/2 | src/features/budget/LineEditorDialog.test.jsx | module missing | 10 pass | fixed vs percent (12,5 -> 1250 bp), month vs onward, over 100 % blocked, empty and non-integer disabled, no-base notice, both remove actions, income has no form, one-month override note, error with Reintentar, initial rule | n/a |
| S6a.3/4 | src/features/budget/BudgetContainer.test.jsx | 7 of 8 new tests failed (onEditLine never provided) | 12 pass | close-then-upsert order with deterministic `br` id, migrated `bl` line updated (no create), remove onward closes at M-1, remove month writes `bo` tombstone, invalid plan writes nothing, write error keeps dialog and retry reuses ids and closes it, override note, canEdit off | `GROUP_LABELS` moved to `groupLabels.js` |
| S6a.5 | npm test, npm run build | n/a | 176 files / 3074 tests pass (one unrelated flaky failure on the first run, green on re-run); build ok | n/a | n/a |

## Size
About 351 lines (tracked diff 151, new files 200). The S6a-1/S6a-2 valve was not needed.

## Work Unit Evidence
- Focused: `npx vitest run src/features/budget` green (52 tests). Runtime harness: N/A (no live Appwrite by rule); `npm run build` passes.
- Rollback: revert the S6a commit; the view returns to read-only (no `onEditLine`).

## Decisions
- The container owns the editor state and renders `LineEditorDialog` through the `header` slot; the shell passes `lines` and `actorId`. Writes: all `updates` first (close old line), then `creates` via `saveBudgetLine`; one `commit` so retry repeats the same ids.
- Errors show inside the dialog (Reintentar); the page banner is hidden while the dialog is open. A plan that fails `validateLine` writes nothing and shows an inline message without Reintentar.
- Known S1b risk handled: when a one-month line exists for (target, M) and the user saves "Desde este mes", the dialog shows "Este mes tiene un ajuste puntual que seguirá aplicando".
- Fixed values are whole amounts (minor = pesos, as `formatMoney`); percent is entered in % (up to 2 decimals, comma or dot) and stored as basis points.
- Income category: dialog shows a notice instead of a form (the view never lists them).

## S6b (branch feat/fb-s6b-category-kinds): S6b.1-S6b.3 complete

| Task | Test file | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|
| S6b.1/2 | src/features/budget/AddCategoryDialog.test.jsx | 3 failed (no Tipo select, no investment option) | 8 pass | option list is exactly need/want/saving/investment/income (no debt); investment stored as kind; income and default need still stored | `SegmentedControl` replaced by a `SelectField` using `GROUP_LABELS` |
| S6b.1/2 | src/features/transactions/TransactionModal.test.jsx | 1 failed (flat options) | 11 pass | optgroups in group order, empty groups skipped, debt category under Deudas; income stays flat | `groupExpenseCategories` helper |
| S6b.1/2 | copy-previous removal | n/a: already removed in S5b | verified | `grep copyPreviousBudgets\|onCopyPrevious\|upsertBudget` over src, scripts, functions, packages is empty after removing the dead `upsertBudget` (appwrite.js) and its App.test mock; BudgetView.test already asserts no copy control | n/a |
| S6b.3 | npm test, npm run build | n/a | `npx vitest run --maxWorkers=6`: 176 files / 3078 tests pass; build ok | n/a | n/a |

## Size
About 93 changed lines (70 additions, 23 deletions).

## Work Unit Evidence
- Focused: `npx vitest run src/features/budget src/features/transactions` green. Runtime harness: N/A (no live Appwrite by rule); `npm run build` passes.
- Rollback: revert the S6b commit (kind select, optgroups, `upsertBudget` return).

## Decisions
- Deviation from task text: `debt` is NOT offered in AddCategoryDialog (system-owned per the design); the kind select offers Necesidades, Gustos, Ahorro, Inversión and Ingreso.
- Tipo is now a native select (five options do not fit a segmented control on phones).

## S7a (branch feat/fb-s7a-dashboard-data): S7a.1-S7a.3 complete

| Task | Test file | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|
| S7a.1/2 | src/shared/lib/monthly.test.js | 3 new tests failed (no group split, savings counted nowhere, no debt rule) | 7 pass | zero-filled months, saving/investment/debt in outflow but not consumption, transfer ignored, income - expenses = 2,500 in the mixed case, debt payments replace cost rows | n/a |
| S7a.1/2 | src/features/dashboard/cashflow.test.js | 1 failed (transfer and saving mixed into expenses) | 3 pass | 4,000,000 income, 3,000,000 outflow, net 1,000,000 = Balance; transfer ignored | n/a |
| S7a.1/2 | src/features/dashboard/categoryDonut.test.js | 1 failed (saving, investment, debt slices drawn) | 5 pass | need/want/untyped kept; saving/investment/debt dropped | n/a |
| S7a.3 | npm test, npm run build | n/a | `npx vitest run --maxWorkers=6`: 3082 tests pass; build ok | n/a | n/a |

## Size
About 128 changed lines (96 additions, 32 deletions).

## Work Unit Evidence
- Focused: `npx vitest run src/shared/lib/monthly.test.js src/features/dashboard`. Runtime harness: N/A (no live Appwrite by rule).
- Rollback: revert the S7a commit (monthly, cashflow, donut and the three shell option args).

## Decisions
- `monthly.js` stays in `src/shared/lib`. `aggregateMonthlyTotals(transactions, months, {categoriesById, debts, debtEvents, inScope})` delegates to `monthOutflows` with a local-time `monthOf`; rows keep the group split and `outflow`, and `expenses` aliases `outflow` so charts and the old KpiCards deltas keep working (income - expenses = Balance). S7b should read `consumption` for "Gastos (consumo)".
- `buildCashflowSeries(..., {categoriesById})` accumulates by `classifyTransaction`: outflow = every non-income group; transfers ignored. Daily debt uses cost rows with `debtId` (no event dates), while monthly bars use debt payments.
- `buildDonutSlices` filters by `groupOfKind(kind)` in CONSUMPTION; `legacyDashboardProps` already carries `kind`.
- Shell passes `categoriesById`, `debts.rows` and ok-only `debtEvents` rows; no change to DashboardView.
