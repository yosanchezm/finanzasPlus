# Delta for dashboard-money-groups

## ADDED Requirements

### Requirement: One classifier everywhere

The dashboard KPIs, monthly totals (`aggregateMonthlyTotals`, month deltas), the category donut and the cashflow chart MUST use the same group classifier as `computeBudgetMonth`, including: transfers ignored, `debtId` rows as debt, unknown kinds as `need`.

#### Scenario: Consistency
- GIVEN one month of transactions
- WHEN KPI cards and monthly totals are computed
- THEN their per-group figures are identical

### Requirement: Gastos is consumption only

The "Gastos" KPI MUST equal consumption (need + want) actual. It MUST exclude saving, investment and debt payments. Its month-over-month delta MUST use the same definition on both months.

#### Scenario: Savings not spending
- GIVEN expenses: need 1000000, want 500000, saving 800000
- THEN Gastos is 1500000

### Requirement: New KPIs

The dashboard MUST show:
- Ahorro + Inversión: saving + investment actual.
- Tasa de ahorro: (saving + investment) / income, shown as a percent; MUST show an empty state (not NaN or Infinity) when income is 0.
- Presupuesto usado: `totals.budgetUsedRatio` (only consumption targets with an active non-zero limit, as defined in budget-computation); empty state when it is null.
- Por asignar: `totals.porAsignarMinor`, shown negative with an over-allocated indication when the `over_allocated` warning is present.
- % del ingreso a deudas: debt actual / income; empty state when income is 0.

When the income base is a reference (`base.source` `reference`) or missing (`base.source` `none`), income-based KPIs MUST show that it is a reference or missing. Names follow the Naming table in `design.md`.

#### Scenario: Presupuesto usado ignores unlimited spending
- GIVEN a Mercado line of 1000000 with actual 500000, and 900000 spent in a `want` category without a limit
- THEN Presupuesto usado is 50%

#### Scenario: Savings rate
- GIVEN income 4000000, saving 600000, investment 200000
- THEN the savings rate is 20%

#### Scenario: Zero income
- GIVEN income 0
- THEN savings rate and debt share show an empty state

### Requirement: Balance (A5)

Balance MUST equal income minus (consumption + saving + investment + debt payments). Transfers MUST NOT affect it.

#### Scenario: Balance
- GIVEN income 4000000, consumption 1500000, saving 800000, investment 200000, debt 500000
- THEN Balance is 1000000

### Requirement: Donut and cashflow

The category donut MUST show consumption categories only. The cashflow chart MUST plot income against total outflows (consumption + saving + investment + debt) per period, so its net equals Balance. Neither MUST include transfers.

#### Scenario: Cashflow net
- GIVEN the Balance example above
- THEN cashflow net for the month is 1000000

### Requirement: Labels and help

UI labels MUST make the changed meaning explicit (Gastos = consumo; Balance includes ahorro, inversión y pagos de deuda), and help text MUST mention the credit-card double counting limitation.

#### Scenario: Label
- WHEN the dashboard renders
- THEN the Gastos KPI is labeled as consumption
