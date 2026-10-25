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
