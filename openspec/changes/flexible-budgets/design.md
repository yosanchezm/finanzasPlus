# Design: Flexible Budgets

One pure module in `packages/finance-core/src/budget/` classifies money into six groups, resolves `budget_lines` for a month, and computes the month (`computeBudgetMonth`). `FinanceShell` computes it once and hands the result to BudgetView and the dashboard. Nia calls the same function. A new create-only `budget_lines` table replaces "copy previous month". A dry-run-first runner migrates `budgets` with deterministic ids. `budgets` is never written again and stays as the read-only fallback and rollback path.

> Size note: the orchestrator requested nine areas, so this design exceeds the 800-word skill budget on purpose. Tables carry most of the detail. The delta specs reference the **Naming table** below as the single source of column and result names.

## Architecture Decisions

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| AD1 | One `budget_lines` table with `fromMonth`/`toMonth` (explore approach 2). | Plan + overrides tables; extra columns on `budgets` | One resolution path. History is kept (the `legal_rates` precedent). The migration is lossless. |
| AD2 | Resolution for target T and month M (spec budget-plan order): candidates cover M; (1) a one-month line for M wins; (2) else the latest `fromMonth`; (3) else the smaller `toMonth` (null = open-ended = largest); (4) else the lexicographically greatest `$id`. No `$updatedAt`. | Unique index per target and month; `$updatedAt` tie-break; row deletes | Total, deterministic and independent of read order. Migrated duplicates can exist, so a unique index could fail to build. |
| AD3 | A line whose resolved amount is 0 is a **tombstone**: "no limit" for that target and period. It is never `overBudget`, never counts in Presupuesto usado, and a tombstoned group envelope means "no envelope". | Deleting rows | The app never deletes lines; a tombstone shadows older lines while keeping history. |
| AD4 | Deterministic ids (see **Row ids**). Web and Nia write `bo`/`br` ids from `prefix + YYYYMM + fnv1a64hex(targetKey)`; migrated rows keep `bl{budgetId}`; seeded plan lines use `bs{YYYYMM of M+1}{hash}`. | `ID.unique()`; raw `targetKey` in the id | Retries and double submits hit the same row. Raw keys could exceed Appwrite's 36-character id limit (cost category ids reach 36). |
| AD5 | `planLineEdit` (pure, in core, shared by web and Nia) implements the edit semantics in **Edit plan**. A one-month edit updates the existing one-month line for (target, M) whatever its id; it creates `bo…` only when none exists. | Writing logic in the shell or in `index.js` | Testable, and web, Nia and migrated `bl…` lines converge on one row per (target, month). |
| AD6 | Percent is stored as integer basis points (`percentBp`, 0–10000) and resolved as `roundUnit(baseIncome × bp / 10000)`. | Float percent | Integer columns, exact round trip. |
| AD7 | Percent base = the month's in-scope real income. When it is 0, the previous month's in-scope income is used (`base.source = 'reference'`); when both are 0, `base.source = 'none'` and percent lines resolve to 0. | Fixed expected-income field | Approved in the proposal. Biweekly pay stays a known risk. |
| AD8 | A non-zero group line is an envelope; category lines are sub-limits (A2). Allocated(group) = envelope, or Σ non-zero sub-limits when the group has no envelope. Warning `sublimits_exceed_envelope`. | Additive group lines | Matches A2. |
| AD9 | Classifier: `transfer` → ignored; `income` type → `income`; an expense with `debtId` → `debt`; otherwise the category kind when it is one of `need`, `want`, `saving`, `investment`, `debt`; anything else (unknown kind, missing category, or an `income`-kind category on an expense) → `need`. Other types → ignored. | Separate classifiers per view | One classifier means BudgetView, dashboard and Nia show identical numbers. |
| AD10 | Debt actual = Σ `amountMinor` of active (not voided) `payment` and `extra_payment` events with `effectiveOn` in M of an in-scope debt, **plus** in-scope expense rows in a `debt`-kind category **without** `debtId`. Rows with `debtId` are classified `debt` but never summed (the payment already includes them). If debt data is unavailable (`debtEvents === null`), the actual is Σ expense rows with `debtId` plus expense rows in `debt`-kind categories, and warning `debt_data_unavailable` is set. | Summing cost rows always | Avoids double counting (A4). Degrades instead of failing. |
| AD11 | Balance = income − outflow, where outflow = consumption (need + want) + saving + investment + debt (A5). "Gastos" = consumption. Cashflow plots income against outflow, so its net equals Balance. | Cashflow on consumption only | One definition of outflow everywhere. |
| AD12 | Presupuesto usado counts only targets with an active non-zero limit in the consumption groups: per group, a non-zero envelope contributes (envelope, group actual); otherwise each category with a non-zero line contributes (line, category actual). `budgetUsedRatio = spent / planned`, null when planned is 0. Saving, investment and debt show progress toward their own target instead. | Counting every group; counting unlimited spending | Keeps today's "only targets with a limit count" rule. Overshooting a saving target is good news, not overspending. |
| AD13 | Scope (A1): editing only in `total`. In Tú/Pareja the percent base is scoped income; fixed lines keep household amounts with `householdFixed: true`. Debts filter by `debt.ownerScope` through `inScope`. | Per-person lines | Out of scope in the proposal. |
| AD14 | `getWorkspace` also loads `budgetLines`, `debts` and `debtEvents` (all rows) through `readOptional` → `{rows, status: 'ok'\|'missing'\|'unavailable'}` (the `readLegal` 404 rule). | Reusing `useDebtData`; month-ranged event queries | `useDebtData` carries reconcile and legal concerns and empties rows on error. A range query would miss void events dated later. `data.refresh()` keeps everything coherent. Partially reverses debt-management AD9 for read-only data. |
| AD15 | **Legacy fallback.** `linesMode = 'legacy'` when `budget_lines` is missing, or when it is empty while `budgets` has at least one row. Then lines come from `linesFromLegacyBudgets(budgets)` and editing is disabled with "Los presupuestos se están migrando; la edición se habilita al terminar." An empty table with no legacy rows is `'lines'` (nothing to migrate, editing enabled). Nia applies the same rule and refuses budget writes in legacy mode. | Treating missing/empty as an empty budget | Never shows a blank budget during the deploy window or after a rollback. |
| AD16 | No line may target income: `validateLine(line, categoriesById)` rejects `targetType: 'group'` with `income` and any category whose kind is `income`. `computeBudgetMonth` also ignores such lines defensively. | Expected-income lines | The percent base already models income; income targets have no defined meaning in Por asignar. |
| AD17 | Nia budget writes are "solo este mes" (A6): a preview that states "solo este mes", then confirmation, then `planLineEdit({span: 'month'})`. Nia delete writes a one-month tombstone. Nia gains the `investment` kind, not `debt`. | Nia editing plans | Keeps the chat path low-risk. |

## Naming table (authoritative; specs use these names)

| Concept | Name |
|---|---|
| Line target | `targetType` (`category`\|`group`) + `targetId` (category `$id` or group key) |
| Target key (hash input) | `category:{categoryId}` or `group:{group}` |
| Line rule | `rule` (`fixed`\|`percent`), `amountMinor` (fixed), `percentBp` (percent) |
| Validity | `fromMonth`, `toMonth` (null = open-ended) |
| Previous month income input | `previousMonthIncomeMinor` |
| Income base | `base.incomeMinor`; `base.source` = `actual` \| `reference` (was `incomeIsReference`) \| `none` (was `incomeMissing`) |
| Por asignar | `totals.porAsignarMinor` (was `unassigned`); warning `over_allocated` when negative (was `overAllocated`) |
| Group figures | `groups[g].allocatedMinor`, `actualMinor`, `remainingMinor`, `overBudget` |
| Category figures | `groups[g].categories[i].plannedMinor`, `actualMinor`, `remainingMinor`, `overBudget`, `householdFixed` (was `householdAmount`) |
| Sub-limit warning | `sublimits_exceed_envelope` with `amountMinor` = excess (was `subLimitsExceedEnvelope`) |
| Presupuesto usado | `totals.budgetUsed: {plannedMinor, spentMinor}` and `totals.budgetUsedRatio` |
| Debt data warning | `debt_data_unavailable` |
| Rates | `rates.savingsRateBp`, `rates.debtShareBp` (null when income is 0) |

`overBudget` = the limit is non-zero and actual > limit. Tombstones (0) are never `overBudget`.

## Row ids

| Kind | Id | Max length |
|---|---|---|
| One-month override (web/Nia) | `bo` + `YYYYMM` + 16 hex | 2 + 6 + 16 = 24 |
| Recurring from M (web) | `br` + `YYYYMM` + 16 hex | 24 |
| Seeded plan | `bs` + `YYYYMM` of M+1 + 16 hex, keyed by category | 24 |
| Migrated row | `bl{budgetId}` | 34 (web `ID.unique()` ids are 20 chars, Nia `randomId()` ids are 32) |

The hash is FNV-1a 64-bit over the UTF-8 bytes of `targetKey`, lowercase hex zero-padded to 16, in `packages/finance-core/src/budget/ids.js`. It uses 16-bit limb arithmetic on Numbers (no BigInt literals), so it passes the Node 16 scan and any Vite target. A migrated row whose `bl{budgetId}` would exceed 36 characters is skipped and reported (not expected with current id sources).

## Edit plan (`planLineEdit`)

Input: `{target, rule, value, month M, span: 'month'|'onward', action: 'set'|'remove', actorId, source}` plus the current lines. Output: `{creates: [{id, data}], updates: [{id, data}]}`, applied as upsert by id.

| Action / span | Plan |
|---|---|
| set / month | Update the existing one-month line for (target, M), whatever its id; otherwise create `bo{M}{hash}`. |
| set / onward | Covering open-ended line with `fromMonth < M` → close it (`toMonth = M−1`) and upsert `br{M}{hash}`. With `fromMonth == M` → update it in place. None → upsert `br{M}{hash}`. Lines starting after M are kept. |
| remove / month ("Quitar solo este mes") | Same as set / month with `fixed` 0: a one-month tombstone. |
| remove / onward ("Quitar desde este mes") | Covering open-ended line with `fromMonth < M` → close it at M−1. With `fromMonth == M` → update it in place to an open-ended tombstone (`fixed` 0). An existing one-month line for (target, M) is also updated to 0. Lines starting after M are kept. |

Every planned row passes `validateLine` first; an invalid plan writes nothing.

## Appwrite schema (migration impact: additive only)

`scripts/lib/budget-schema.mjs` exports `BUDGET_TABLES` and `withBudgetSchema(tables, team)`, which throws on redefinition, as `withLegalSchema` does. `migrate-appwrite.mjs` chains it as `withBudgetSchema(withLegalSchema(withDebtSchema(base, team), team), team)`.

| Column | Type | Size | Req | Notes |
|---|---|---|---|---|
| householdId | string | 36 | R | |
| targetType | string | 16 | R | `category` \| `group` |
| targetId | string | 36 | R | categoryId or group key |
| rule | string | 16 | R | `fixed` \| `percent` |
| amountMinor | integer | — | | required when `fixed` (validated in core) |
| percentBp | integer | — | | required when `percent` |
| fromMonth | string | 7 | R | `YYYY-MM` |
| toMonth | string | 7 | | null = open-ended |
| alertAtPercent | integer | — | | kept from `budgets` |
| actorId | string | 36 | R | `migration` for migrated rows |
| source | string | 16 | R | `web` \| `telegram` \| `migration` |

- **Indexes.** `by_household_from` [householdId, fromMonth] and `by_household_target` [householdId, targetType, targetId]. No unique index (AD2).
- **Permissions.** Table: team read, create and update. Row: team read and update, set at insert. No delete.
- `categories.kind` (s24) already fits `investment` and `debt`.

## Interfaces / Contracts (`packages/finance-core/src/budget/`, re-exported from `index.js`)

| File | Exports |
|---|---|
| `groups.js` | `GROUPS`, `CONSUMPTION = ['need','want']`, `groupOfKind(kind)`, `classifyTransaction(tx, categoriesById)` → group or `null` |
| `ids.js` | `fnv1a64hex(text)`, `targetKey(target)`, `lineIds` (`override`, `recurring`, `migrated`, `seeded`) |
| `lines.js` | `validateLine(line, categoriesById)`, `coversMonth`, `resolveLines(lines, month)` → `Map<targetKey, line\|null>`, `linesFromLegacyBudgets(budgets)` |
| `edit.js` | `planLineEdit(lines, request)` (see **Edit plan**) |
| `compute.js` | `computeBudgetMonth(input)` |
| `outflows.js` | `monthOutflows(transactions, debtEvents, debts, months, categoriesById)` → per month `{income, consumption, saving, investment, debt, outflow}` |

```js
computeBudgetMonth({ month, lines, categories, transactions, previousMonthIncomeMinor,
  debts, debtEvents /* null = unavailable */, inScope = () => true, scoped = false })
→ { month, base: { incomeMinor, source },
    groups: { [group]: { envelope, allocatedMinor, subLimitsMinor, actualMinor, remainingMinor, overBudget,
      categories: [{ categoryId, name, color, line, plannedMinor, actualMinor, remainingMinor, overBudget, householdFixed }] } },
    totals: { incomeMinor, consumptionMinor, savingMinor, investmentMinor, debtMinor, outflowMinor, balanceMinor,
      allocatedMinor, porAsignarMinor, budgetUsed: { plannedMinor, spentMinor }, budgetUsedRatio },
    rates: { savingsRateBp, debtShareBp },
    warnings: [{ code, group?, amountMinor? }] }
```

Only active categories are listed, so a line on an archived category is ignored. New files must be added to the file list in `packages/finance-core/test/node16.test.js`.

## Data Flow

```
getWorkspace ─ readOptional(budget_lines, debts, debt_events) + budgets ─┐
useFinanceData(period tx + 5-month history) ─────────────────────────────┤
                                                                         ▼
FinanceShell ── linesMode + useMemo computeBudgetMonth ──> BudgetContainer ─> BudgetView (+ LineEditorDialog)
     │                                                └> DashboardView ─> KpiCards / CategoryBreakdown
     └─ monthOutflows ──> history, deltas, cashflow (income vs outflow)
LineEditorDialog ─ planLineEdit ─ saveBudgetLine (upsert) ─ data.refresh()
Nia ─ listRows(budget_lines, budgets, debts, debt_events, tx M and M−1) ─ computeBudgetMonth ─ replies
Nia ─ preview "solo este mes" ─ confirm ─ planLineEdit ─ upsertRow
```

## Web

- **Shell.** `budgetMonth` computed once. `categoryStats`, `budgetTotal`, `budgetedSpent`, `saveBudget` and `copyPreviousBudgets` are removed. `canEdit = scope === 'total' && linesMode === 'lines' && linesStatus === 'ok'`.
- **`BudgetContainer.jsx`** (container). Editor state and `saveState` (no-optimistic, as Deudas), `planLineEdit`, sequential writes, then `onRefresh`. Shows the legacy notice (AD15).
- **`BudgetView.jsx`** (presentational). Header: income base ("Referencia: {mes anterior}" badge), Asignado, Por asignar. Sections need, want, saving, investment, debt; category rows with planned, actual, remaining, rule chip, "Hogar" chip, `overBudget` styling (saving/investment overshoot styled as achieved).
- **`LineEditorDialog.jsx`.** Fijo/Porcentaje, value, "Solo este mes"/"Desde este mes", "Equivale a $X" preview, "Quitar solo este mes" and "Quitar desde este mes".
- **`AddCategoryDialog`** kind select gains Inversión and Deuda. **`TransactionModal`** groups expense categories by group (`optgroup`).
- **Dashboard.** `monthly.js` delegates to `monthOutflows`. `cashflow.js` plots income vs outflow (AD11), transfers ignored. `categoryDonut` shows consumption only. `KpiCards`: Balance, Ingresos, Gastos (consumo), Ahorro e inversión (savings rate), Deudas (% of income), Presupuesto usado (`budgetUsedRatio`, Por asignar subline).
- **`src/appwrite.js`.** `TABLES.budgetLines`, `readOptional`, `saveBudgetLine(id, data)`, `updateBudgetLine`, `COST_CATEGORY.kind = 'debt'`.

## Migration (`scripts/lib/budget-migration.mjs` + `scripts/migrate-budgets.mjs`)

- **Planner** `planBudgetMigration({budgets, existingLineIds, categories, seed = true})` → `{creates, seeds, skipped, duplicates, costCategoryPatches, summary}`. Pure; reuses `linesFromLegacyBudgets`, `lineIds` and `validateLine`.
  - Each row maps 1:1 to a one-month fixed line `bl{budgetId}`. Skipped and reported: `plannedMinor` 0, missing month, missing category, `income`-kind category, id longer than 36.
  - Seed: M = latest month among mapped rows. For each category with a mapped row in M, one open-ended fixed line from M+1 with id `bs{M+1}{hash(category:{id})}`. When a category has several rows in M, the AD2 tie-break picks one and the others are listed in `duplicates`. No rows → no seed.
  - Existing ids are skipped, never overwritten.
  - `costCategoryPatches`: every category matching "Costos financieros" (case- and accent-insensitive, archived included) whose kind is not `debt` → `{id, from, to: 'debt'}`.
- **Runner.** Same CLI shape as `merge-categories.mjs`; dry run by default; `--no-seed`. `--apply` aborts with "Ejecuta npm run migrate:appwrite" when `budget_lines` is missing, then writes `backups/budget-migration-*.json` (raw `budgets` rows, every matched cost category row before the patch, existing line ids) and aborts if that fails. POST rows (`409` = done), then PATCH kinds. Re-running creates nothing. `package.json` gets `migrate:budgets`.

## Nia (`functions/nia/budget.js`, `index.js`, `debt/handler.js`, README)

- Snapshot loads `budget_lines` (paginated), `budgets`, `debts`, `debt_events` and transactions of M and M−1; applies AD15; calls `computeBudgetMonth`. A failed debt read passes `debtEvents: null`.
- Budget create/update: preview with category, amount and "solo este mes", confirmation, then `planLineEdit({span: 'month', action: 'set'})`. Delete: same flow with `action: 'remove'`. In legacy mode the write is refused with the migration message. `budgets` is no longer written.
- Replies pass code-computed figures (allocated, actual, Por asignar). Kind enum adds `investment`. `COST_CATEGORY.kind = 'debt'`. README documents the table and deploy order.

## Testing Strategy (strict TDD, Vitest)

| Slice | RED-first tests |
|---|---|
| S1a | Classifier truth table; FNV-1a vectors and id lengths ≤ 36; `validateLine` (income group/category rejected); resolution order and shuffled input; tombstones; legacy mapping. Node 16 scan. |
| S1b | `planLineEdit`: every row of **Edit plan**, existing `bl…` one-month line reused, future lines kept. |
| S1c | Percent rounding; base sources; envelope vs sub-limits; `overBudget`; Por asignar; `budgetUsedRatio`; debt events void-aware and scoped; debt-kind rows without `debtId`; fallback warning; rates with income 0. |
| S1d | `monthOutflows` outflow and net = Balance. |
| S2a/S2b | Schema snapshot and chain; planner skips, seed M+1 ids, duplicates, idempotency, multiple cost patches. |
| S3 | Abort on missing table; backup before writes; abort on backup failure. |
| S4 | `readOptional` (404/500); `linesMode` (missing, empty with legacy, empty without legacy). |
| S5–S8 | RTL views, editor plans per action/span, KPIs, Nia preview text, confirmation, legacy refusal. |

## Slices (≤400 changed lines each, tests included)

| # | Content | Est. | Depends on |
|---|---|---|---|
| S1a | `groups.js`, `ids.js`, `lines.js`, barrel, node16 list, tests | 320 | — |
| S1b | `edit.js`, tests | 230 | S1a |
| S1c | `compute.js`, tests | 380 | S1a |
| S1d | `outflows.js`, tests | 120 | S1c |
| S2a | `budget-schema.mjs`, migrate chain, tests | 140 | — |
| S2b | `budget-migration.mjs` planner, tests | 320 | S1a |
| S3 | `migrate-budgets.mjs`, `package.json`, web `COST_CATEGORY` | 260 | S2b |
| S4 | `appwrite.js`, `getWorkspace`, `linesMode`, shell memo, tests | 330 | S1c |
| S5a | `BudgetContainer`, header, legacy notice, tests | 250 | S4 |
| S5b | Group sections and category rows, tests | 260 | S5a |
| S6a | `LineEditorDialog`, save path, tests | 340 | S1b, S5b |
| S6b | `AddCategoryDialog`, `TransactionModal`, copy-previous removal, tests | 170 | S5a |
| S7a | `monthly.js`, `cashflow.js`, `categoryDonut`, tests | 230 | S1d, S4 |
| S7b | `KpiCards`, `DashboardView`, tests | 260 | S7a |
| S8a | `functions/nia/budget.js` (snapshot inputs, preview, plan), tests | 320 | S1b, S1c |
| S8b | `index.js` wiring, kind enum, `COST_CATEGORY`, README, tests | 220 | S8a |

S1c is the closest to the limit; if it overflows, move debt actuals into `debtActual.js` as S1c′.

## Threat Matrix

N/A: no routing, shell, subprocess, VCS/PR automation, executable-file classification or process-integration boundary. The runner is a plain `fetch` script with the same safeguards as `merge-categories.mjs`.

## Migration / Rollout

1. Merge S2a, then run `npm run migrate:appwrite` (creates `budget_lines`).
2. Run `npm run migrate:budgets` (dry run); review mapping, skips, duplicates and seed. Then `--apply` (aborts if the table is missing; backup first).
3. Deploy the web app (S4–S7) **only after step 2 `--apply`**. AD15 still protects any window where the table is missing or empty.
4. Package and deploy Nia (S8).

**Rollback.** Revert the web and Nia deploys. `budgets` is untouched, so the old behavior returns. The `budget_lines` rows can stay. Revert cost category kinds with the backup values. Caveat: line edits made after cut-over are not mirrored into `budgets`.

## Open Questions

- [ ] Is the reference base enough for biweekly pay (proposal Q1)?
- [ ] Should the seed run automatically (current default, `--no-seed` to opt out) or be a one-click action (proposal Q3)?
