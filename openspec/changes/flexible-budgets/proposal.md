# Proposal: Flexible Budgets

## Intent

Budgets today are fixed per-category, per-month rows, copied forward by hand. They cannot express "20% of income to savings", group envelopes, debt payments, or investments. The dashboard also counts savings as spending. Goal: one recurring plan, computed once, shown the same way everywhere.

## Scope

### In Scope
- Six groups: income, need, want, saving, investment (new), debt (new). Saving, investment and debt are not consumption.
- `budget_lines`: target is a category or a group; rule is `fixed` or `percent` (basis points); `fromMonth`/`toMonth` give a recurring plan plus one-month overrides. This replaces "copy previous month".
- Percent base is the month's real in-scope income. Before any income arrives, the previous month's income is used and flagged as reference.
- "Por asignar" = income minus allocated.
- Debt group actual comes from debt payment events. "Costos financieros" moves to the debt group.
- Pure `computeBudgetMonth` in finance-core, shared by BudgetView, the dashboard and Nia.
- Dashboard: Gastos counts consumption only. Adds Ahorro+Inversión with savings rate, Presupuesto usado, Por asignar, and % of income to debts.
- Idempotent migration from `budgets`.

### Out of Scope
- Per-person budgets.
- Goal contributions as Ahorro.
- Fixing double counting of card purchases and card payments (spec open question).
- Deleting the `budgets` table.

## Assumptions (reversible; user may override)

| # | Assumption |
|---|---|
| A1 | Lines are edited only in the Hogar scope. In Tú/Pareja, percent lines scale with scoped income; fixed lines show household amounts, flagged. |
| A2 | A group line is an envelope and category lines are sub-limits. Warn when sub-limits exceed the envelope. |
| A3 | Each `budgets` row becomes a one-month line (id `bl{budgetId}`). Add an open-ended plan seeded from the latest budgeted month. |
| A4 | Debt actual = active `payment` + `extra_payment` events, void-aware. |
| A5 | Balance = income − (consumption + saving + investment + debt payments). |
| A6 | Nia budget commands set "this month only". Nia gains the `investment` kind, not `debt`. |

## Capabilities

### New Capabilities
- `budget-plan`: lines, targets, rules, recurrence, override resolution, Hogar-only editing.
- `budget-computation`: groups, percent base and reference fallback, Por asignar, envelopes, debt actuals, scope behavior.
- `budget-migration`: `budgets` → `budget_lines`, plan seeding, cost-category kind patch.
- `dashboard-money-groups`: KPIs, monthly totals, donut and cashflow on the shared classifier.
- `nia-budgets`: Nia reads and writes lines, plus the `investment` kind.

### Modified Capabilities
- None (no existing specs).

## Approach

Single `budget_lines` table, per explore approach 2: the latest covering `fromMonth` wins, and editing a line closes it and opens a new one. A dependency-free `computeBudgetMonth` in `packages/finance-core` classifies by group, and any row with a `debtId` counts as debt. The shell loads debts and debt events.

## Affected Areas

| Area | Impact |
|---|---|
| Appwrite schema: `scripts/lib/budget-schema.mjs`, `migrate-appwrite.mjs` | New table |
| `scripts/` budget migration planner/runner | New |
| `packages/finance-core` | New groups + computation |
| Frontend: `src/appwrite.js`, `FinanceShell.jsx`, `useFinanceData.js`, `BudgetView.jsx`, `AddCategoryDialog.jsx`, `TransactionModal.jsx`, dashboard files, `monthly.js` | Modified |
| Nia: `functions/nia/index.js`, `debt/handler.js`, README | Modified |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Percent base unstable with biweekly pay | Med | Reference flag; revisit in spec |
| Nia and web diverge during deploy | Med | Deploy order; 404 tolerance |
| Balance/Gastos meaning shifts | High | One shared classifier; UI labels |
| Card purchase+payment double count | Med | Spec open question |
| `KpiCards` untested | Med | Tests written first (strict TDD) |

## Rollback Plan

- `budgets` stays untouched and Nia/web tolerate a missing `budget_lines` (404).
- Revert the web and Nia deploys to restore old behavior.
- Migration lines use deterministic ids and can be dropped or re-run.
- Revert the `COST_CATEGORY.kind` patch with a one-row update.
- Deploy order: `migrate:appwrite` → migration dry run, then apply → web → Nia.

## Slices (chained, ≤400 lines each)

S1 finance-core · S2 schema + planner · S3 runner + cost kind · S4 CRUD + shell data · S5 BudgetView read · S6 editor + kinds · S7 dashboard · S8 Nia.

## Dependencies

- Nia stays on Node 16, so finance-core stays dependency-free ESM.

## Success Criteria

- [ ] BudgetView, dashboard and Nia show identical numbers for the same month and scope.
- [ ] A recurring plan applies to future months without copying.
- [ ] Migration dry run reports a 1:1 mapping, and re-running creates no duplicates.
- [ ] Gastos excludes saving, investment and debt payments.
- [ ] `npm test` and `npm run build` pass for each slice.

## Proposal question round

Questions for the user (defaults above apply if skipped):
1. Is the previous-month reference enough for biweekly pay, or should percent lines use the full previous-month income?
2. Should Tú/Pareja ever allow editing lines (A1)?
3. Should the seeded plan (A3) be created automatically or offered as a one-click action?
