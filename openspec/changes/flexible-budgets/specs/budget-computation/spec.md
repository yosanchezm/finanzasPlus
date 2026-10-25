# Delta for budget-computation

## ADDED Requirements

### Requirement: Pure shared computation

`packages/finance-core` MUST export a pure, dependency-free ESM function `computeBudgetMonth({ lines, month, categories, transactions, debts, debtEvents, previousMonthIncomeMinor, inScope, scoped })`. Input and result names MUST follow the Naming table in `design.md`. It MUST perform no I/O and MUST NOT mutate its inputs. BudgetView, the dashboard and Nia MUST all use it, so the same month, scope and data MUST yield identical numbers everywhere. It MUST run on Node 16.

#### Scenario: Same result in all consumers
- GIVEN the same inputs
- WHEN BudgetView, the dashboard and Nia call it
- THEN allocated, actual, Por asignar and income base are identical

### Requirement: Transaction classification

Each in-scope transaction of the month MUST be classified once:
- `type: 'transfer'` MUST be ignored entirely (neither income nor outflow).
- A transaction with a `debtId` MUST be classified in the `debt` group, regardless of its category kind.
- Otherwise income-type transactions count as income, and expense-type transactions take their category's group; unknown or missing category kind, and an expense in an `income`-kind category, MUST map to `need`.
- Types other than income, expense and transfer MUST be ignored.

Each transaction MUST be counted in exactly one group.

#### Scenario: Transfer ignored
- GIVEN a transfer of 1000000 between accounts
- WHEN computing
- THEN income and all group actuals are unchanged

#### Scenario: Debt cost row
- GIVEN an expense in "Costos financieros" carrying a `debtId`
- WHEN classified
- THEN it belongs to `debt`, not `need`

#### Scenario: Unknown kind
- GIVEN an expense in a category with kind `"legacy"`
- THEN it is counted in `need`

### Requirement: Income base for percent lines

The base for percent lines MUST be the real in-scope income of the month (sum of in-scope income transactions, transfers excluded). When that is 0, the base MUST be `previousMonthIncomeMinor` (in-scope income of the preceding month) and `base.source` MUST be `reference`. When both are 0, the base MUST be 0, every percent line MUST resolve to 0, and `base.source` MUST be `none`. When the month's real income is greater than 0, it MUST be used and `base.source` MUST be `actual`.

#### Scenario: Real income present
- GIVEN month income 4000000 and percent line 2000 bp
- THEN the line amount is 800000 and `base.source` is `actual`

#### Scenario: Reference fallback
- GIVEN month income 0 and previous month income 3000000
- WHEN computing a 1000 bp line
- THEN the amount is 300000 and `base.source` is `reference`

#### Scenario: No income at all
- GIVEN both months have income 0
- THEN percent lines are 0 and `base.source` is `none`

### Requirement: Percent rounding

A percent line amount MUST be `roundUnit(base * percentBp / 10000)` using the finance-core `roundUnit` helper, computed on integer values. Percentages MUST be stored and computed only as integer basis points.

#### Scenario: Rounding
- GIVEN base 3333333 and 1500 bp
- THEN the amount equals `roundUnit(3333333 * 1500 / 10000)`, an integer

### Requirement: Allocation per group

Each non-income group's `allocatedMinor` MUST be:
- the resolved non-zero amount of its group line (an envelope), when one exists; otherwise
- the sum of the resolved category lines whose category belongs to that group.

A zero group line (tombstone) MUST count as no envelope. A category line MUST be counted only once and MUST NOT be added on top of an envelope. Lines targeting income (rejected by validation) MUST be ignored if present. Each category MUST report its own `plannedMinor` and `actualMinor`.

#### Scenario: Envelope wins
- GIVEN a `want` envelope of 500000 and category lines of 200000 and 250000 in `want`
- THEN `want` allocated is 500000

#### Scenario: No envelope
- GIVEN no group line for `need` and category lines 300000 and 400000
- THEN `need` allocated is 700000

### Requirement: Over-envelope warnings

When a group has an envelope and its sub-limits (category lines) sum to more than the envelope, the result MUST include a warning `sublimits_exceed_envelope` with `amountMinor` = the excess. When a group's actual exceeds its allocated amount (and allocated > 0), the group MUST be flagged `overBudget`. A category whose actual exceeds its own non-zero line MUST be flagged `overBudget`. A target whose line resolves to 0 (tombstone) MUST NOT be flagged `overBudget`. Warnings MUST NOT change the allocated amounts.

#### Scenario: Sub-limits exceed envelope
- GIVEN envelope 500000 and category lines summing 600000
- THEN the warning reports an excess of 100000 and allocated stays 500000

#### Scenario: Tombstone never over budget
- GIVEN a category whose line resolves to 0 and an actual of 300000
- THEN the category is not `overBudget`

### Requirement: Por asignar

`totals.porAsignarMinor` MUST equal `base.incomeMinor - sum(allocatedMinor of need, want, saving, investment, debt)`. It MAY be negative, in which case the result MUST include the warning `over_allocated`. Envelopes and their sub-limits MUST NOT be counted twice.

#### Scenario: Not double counted
- GIVEN income 4000000, `want` envelope 500000 with sub-limits 200000 and 250000, and `need` lines 1500000
- THEN `porAsignarMinor` is 4000000 - 500000 - 1500000 = 2000000

#### Scenario: Over-allocated
- GIVEN income 1000000 and allocated 1200000
- THEN `porAsignarMinor` is -200000 and the `over_allocated` warning is present

### Requirement: Debt actuals

When `debts` and `debtEvents` are provided, the `debt` group actual MUST be the sum of:
- amounts of active `payment` and `extra_payment` events whose `effectiveOn` falls in the month, void-aware (events voided by a `void` event MUST be excluded) and joined to a debt that passes `inScope`; plus
- in-scope expense transactions in a `debt`-kind category that carry no `debtId`.

Transactions with a `debtId` MUST be excluded from `need`/`want` and MUST NOT be added to the debt actual (the event already covers the payment). `disbursement` and `charge` events MUST NOT count. When debt data is not available (`debtEvents` null), the `debt` actual MUST fall back to the sum of in-scope expense transactions that carry a `debtId` or belong to a `debt`-kind category, and the result MUST include the warning `debt_data_unavailable`. Nia MUST load `debts` and `debt_events` to provide this input.

#### Scenario: Void-aware
- GIVEN a payment of 500000 in the month and a `void` event for it
- THEN the debt actual is 0

#### Scenario: Extra payment
- GIVEN a payment of 300000 and an extra_payment of 200000
- THEN the debt actual is 500000

#### Scenario: No double count with cost rows
- GIVEN a payment event of 500000 and a debt cost row of 40000 carrying `debtId`
- THEN the debt actual is 500000 and `need` is unaffected

#### Scenario: Debt-kind expense without debtId
- GIVEN a payment event of 500000 and an expense of 80000 in a `debt`-kind category with no `debtId`
- THEN the debt actual is 580000

#### Scenario: Debt data unavailable
- GIVEN `debtEvents` null, a cost row of 40000 with `debtId` and an expense of 80000 in a `debt`-kind category
- THEN the debt actual is 120000 and the `debt_data_unavailable` warning is present

### Requirement: Scope behavior

All actuals and the income base MUST be filtered by `inScope`. Percent lines MUST apply to the scoped income base. Fixed lines MUST keep their household amount in every scope, and the result MUST flag them `householdFixed: true` when the scope is not the household total.

#### Scenario: Scoped percent
- GIVEN scope Tú with scoped income 2000000 and a 2000 bp household line
- THEN the amount is 400000

#### Scenario: Fixed line in partial scope
- GIVEN scope Pareja and a fixed 500000 line
- THEN it is shown as 500000 with `householdFixed` true

### Requirement: Budget used and totals

The result MUST include per group `allocatedMinor`, `actualMinor`, `remainingMinor` and `overBudget`, and totals including `consumptionMinor` (need + want actual), `outflowMinor` (consumption + saving + investment + debt) and `balanceMinor` (income − outflow).

Presupuesto usado MUST count only consumption targets (`need`, `want`) with an active non-zero limit. Per consumption group: when it has a non-zero envelope, the envelope adds to `budgetUsed.plannedMinor` and the group actual adds to `budgetUsed.spentMinor`; otherwise each category with a non-zero line adds its line and its own actual. Spending in targets without a limit MUST NOT count. `budgetUsedRatio` MUST be `spentMinor / plannedMinor`, and null when `plannedMinor` is 0.

#### Scenario: Ratio
- GIVEN `need` category lines Mercado 1000000 (actual 800000) and Arriendo 1000000 (actual 700000), and an unlimited `want` category with actual 400000
- THEN `budgetUsed` is planned 2000000 and spent 1500000, and `budgetUsedRatio` is 0.75

#### Scenario: Envelope counts the whole group
- GIVEN a `want` envelope of 500000 and a `want` actual of 600000
- THEN the envelope adds 500000 planned and 600000 spent

#### Scenario: No limits
- GIVEN no non-zero consumption limits
- THEN `budgetUsedRatio` is null

### Requirement: Known limitation, credit-card double counting

This change MUST NOT attempt to deduplicate credit-card purchases against credit-card payments. A card purchase counts in its category when recorded, and a payment to a card debt counts again as a debt payment. This limitation MUST be documented in code comments and the BudgetView/dashboard help text; no automatic dedupe is required.

#### Scenario: Documented limitation
- GIVEN a card purchase of 100000 and a later card payment event of 100000
- THEN both are counted (consumption 100000 and debt 100000)
- AND the limitation is documented
