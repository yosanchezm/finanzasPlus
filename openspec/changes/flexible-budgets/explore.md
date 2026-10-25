# Exploration: flexible-budgets

## Goal

Replace fixed per-category monthly budget rows with a flexible plan:
- Six money groups: Ingreso (income), Necesidad (need), Deseo (want), Ahorro (saving), Inversión (investment, new) and Deudas (debt, new).
- Lines that target a category or a whole group, with a `fixed` or `percent` rule.
- Percentages computed on the month's real income.
- A recurring plan with per-month overrides.
- "Por asignar" (income minus allocated).
- One pure computation shared by the budget view, the dashboard and Nia.

## Current state (verified)

### Budgets
- The `budgets` table has one row per category per month and no `ownerScope` (`scripts/migrate-appwrite.mjs:79-86`).
- `FinanceShell.jsx:120-128` builds `categoryStats` for every non-income category. Only categories that have a limit count toward the total.
- `copyPreviousBudgets` upserts one row per category.

### Scope
- `inScope(item)` returns true when the scope is total, when `item.ownerScope` equals the stored scope, or when the item is `shared`.
- Budgets are household-level, while actual spending is filtered by scope. This mismatch exists today.

### Loading
- `getWorkspace` loads households, members, categories, budgets and goals.
- `useFinanceData` loads the month's transactions and 5 months of history, which covers the previous month's income.
- Debts and debt events are loaded only in `useDebtData`, when the Deudas view opens. The shell never sees them.

### Debt costs
- `buildCostRow` (`packages/finance-core/src/ledger/commit.js:41`) writes an expense with `source:'debt'`, `debtId`, and `ownerScope = debt.ownerScope`.
- `COST_CATEGORY` has kind `'need'`. It is duplicated in `src/appwrite.js:391` and `functions/nia/debt/handler.js:31`.
- `debt_events` has no `ownerScope`; it is joined through `debts`.
- Event kinds include `payment`, `extra_payment`, `void`, `disbursement` and `charge`. `activeEvents` handles voids. `effectiveOn` is `YYYY-MM-DD`.

### Categories
- `kind` is a free string (size 24), so `investment` and `debt` need no schema change.
- Nia hard-codes `['need','want','saving','income']` (`functions/nia/index.js:668`).
- `AddCategoryDialog` offers only need and income.
- `TransactionModal` and `BudgetView` treat every non-income category as an expense.

### Transfers
- Only Nia creates `type:'transfer'` (`index.js:595`).
- Web aggregates filter by exact type, so transfers are ignored.

### Nia
- Nia reads budgets for its snapshot (`index.js:543`) and writes `budgets` directly (`:916-924`).
- It imports `packages/finance-core`, which must stay dependency-free ESM because Nia runs on Node 16.

### Schema script
- New tables are added with `scripts/lib/*-schema.mjs` via `with*Schema(tables, team)`, chained at `migrate-appwrite.mjs:134`.
- `TRANSACTIONS_DEBT_PATCH` is the pattern for adding a column to an existing table.
- The script is create-only and there is no row-delete convention. Rows are soft-closed with validity ranges, as `legal_rates` does.

### Migration precedent
- `scripts/merge-categories.mjs` with `scripts/lib/category-merge.mjs`: a pure planner, a dry run by default, and a backup JSON on `--apply`.
- That script can double-apply if interrupted. The new migration uses deterministic row ids to avoid this.

## Affected areas

- `packages/finance-core`: budget groups and `computeBudgetMonth`, plus tests.
- Scripts:
  - `scripts/lib/budget-schema.mjs`, chained into `migrate-appwrite.mjs`.
  - Migration planner and runner.
  - `package.json` scripts.
- `src/appwrite.js`: tables, line CRUD, `getWorkspace`, `COST_CATEGORY.kind`.
- App and views:
  - `src/app/useFinanceData.js` (or a new hook) to load debts and debt events for the shell.
  - `FinanceShell.jsx`.
  - `BudgetView.jsx` (near rewrite).
  - `AddCategoryDialog.jsx`.
  - `TransactionModal.jsx`.
- Dashboard: `KpiCards.jsx`, `DashboardView.jsx`, `CategoryBreakdown.jsx`, `categoryDonut.js`, `cashflow.js`, and `src/shared/lib/monthly.js`.
- Nia:
  - `functions/nia/index.js`: budget read and write, kind enum, snapshot.
  - `functions/nia/debt/handler.js`: `COST_CATEGORY`.
  - Nia README.
- Tests:
  - Existing tests for each area above.
  - New tests for finance-core budget, the schema and the migration planner.
  - Confirm that the root Vitest include globs cover `packages/finance-core/test`.

## Approaches (data model)

1. **Two tables, `budget_lines` (plan) and `budget_overrides` (per month).**
   - Clear separation between plan and exceptions.
   - Two resolution paths.
   - Editing the plan rewrites past months unless the plan is also versioned.
   - Effort: medium-high.
2. **One table, `budget_lines`, with `fromMonth` and `toMonth` (recommended).**
   - An open-ended line is the recurring plan.
   - A line with `fromMonth == toMonth` is a one-month override.
   - Per target and month, the covering line with the latest `fromMonth` wins. A one-month line wins over a recurring line.
   - "Edit from this month on" closes the old line and opens a new one.
   - History is preserved, which follows the `legal_rates` precedent.
   - The migration is lossless: each old row becomes a one-month line.
   - Effort: medium.
3. **Add columns to `budgets`.**
   - Cannot express group targets or recurrence. Rejected.

## Recommendation

Use approach 2. Add one pure `computeBudgetMonth({ lines, month, categories, transactions, debts, debtEvents, previousMonthIncome, inScope })`, used by BudgetView, the dashboard and Nia.

Supporting decisions:
- **Debt classification.** A transaction with `debtId` belongs to the debt group. Change `COST_CATEGORY.kind` to `'debt'` in both copies, and patch the existing "Costos financieros" category once.
- **Debt actuals.** The month's active `payment` and `extra_payment` events, void-aware and joined to an in-scope debt.
- **Percent storage.** Store percentages as integer basis points and round them with `roundUnit`.
- **Group lines.** A group line is an envelope and category lines are sub-limits. The amount allocated to a group is its envelope, or the sum of its category lines when it has no envelope. Warn when the sub-limits exceed the envelope.
- **Transfers.** Ignore them explicitly.
- **Unknown kinds.** Treat unknown or legacy kinds as `need`, as today.
- **Rollout order.**
  1. `migrate:appwrite`.
  2. Budget migration, dry run first.
  3. Deploy the web app.
  4. Deploy Nia.
  - Never delete `budgets`; it is the rollback path.
  - Tolerate a missing table (404) the way `readLegal` does.
  - Use deterministic line ids (`bl{budgetId}`).

## Risks

- Real income as the percent base is unstable with biweekly pay. The previous-month reference only covers the case where no income has arrived yet.
- Nia and the web app can diverge during the deploy window.
- The meaning of Balance and Gastos changes once savings, investments and debt principal are outflows. `aggregateMonthlyTotals` (deltas and cashflow) needs the same classifier.
- Double counting:
  - Debt cost rows plus payment events (solved by classifying on `debtId`).
  - Card purchases plus the card payment.
  - Goal contributions create no transaction, so Ahorro never sees them.
- In the you and partner scopes, fixed household lines are compared with scoped actuals.
- `KpiCards` has no covering tests today.

## Rough sizing (lines including tests, aiming for at most 400 per slice)

| Slice | Content | Est. lines |
|---|---|---|
| S1 | finance-core groups + `computeBudgetMonth` | 350-400 |
| S2 | Budget schema + migration planner | ~300 |
| S3 | Migration runner + cost category kind | ~250 |
| S4 | Appwrite CRUD + shell data wiring | ~300 |
| S5 | BudgetView read side | ~400 |
| S6 | BudgetView editor + category kinds | ~350 |
| S7 | Dashboard KPIs, monthly totals, donut, cashflow | ~350 |
| S8 | Nia | ~200 |

## Open questions

1. In the you and partner scopes, how should fixed lines show, and can lines be edited there?
2. Is a group line an envelope over its category lines, or an additional line?
3. Should the migration also seed an open-ended plan from the latest month?
4. Do `extra_payment` events count? How do card purchases avoid double counting?
5. What does Balance mean after the change? Do goal contributions count as Ahorro?
6. Should Nia budget commands set this month only, or every month?
7. Is real income acceptable as the percent base with biweekly pay?
