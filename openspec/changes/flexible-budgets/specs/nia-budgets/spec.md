# Delta for nia-budgets

## ADDED Requirements

### Requirement: Budget commands write this-month-only lines (A6)

A Nia budget command MUST create or update a one-month line (`fromMonth` = `toMonth` = current month) for the matched category, rule `fixed`. It MUST NOT alter the recurring plan and MUST NOT write to the legacy `budgets` table. If a one-month line already exists for that category and month, it MUST be updated in place whatever its id (no duplicate); otherwise the new line MUST use the deterministic `bo` id defined in `design.md`. The preview MUST show the category, the amount and "solo este mes", and the write MUST happen only after confirmation. A Nia budget delete MUST follow the same preview and confirmation and MUST write a one-month tombstone (amount 0) for the current month. Nia MUST NOT accept a budget for an `income`-kind category. In legacy mode (see budget-migration) Nia MUST refuse budget writes with the migration-pending message.

#### Scenario: Set budget
- GIVEN "budget Mercado 900 thousand"
- WHEN confirmed
- THEN one one-month line for Mercado, current month, fixed 900000 exists
- AND the open-ended plan is unchanged

#### Scenario: Repeat
- GIVEN a one-month line already exists for that category and month
- WHEN the user sets another amount
- THEN that line is updated and no second one exists

#### Scenario: Preview before write
- GIVEN "budget Mercado 900 thousand"
- WHEN Nia replies before confirmation
- THEN the preview names Mercado, 900000 and "solo este mes", and nothing is written until the user confirms

#### Scenario: Delete this month
- GIVEN a recurring Mercado line and a confirmed Nia budget delete for Mercado
- THEN a one-month tombstone for the current month exists and the recurring line is unchanged

### Requirement: Investment kind

Nia MUST accept `investment` as a category kind alongside `need`, `want`, `saving` and `income`. Nia MUST NOT offer or create the `debt` kind. Legacy and unknown kinds MUST still be read as `need`.

#### Scenario: New category
- GIVEN the user creates a category with kind investment
- WHEN confirmed
- THEN it is stored with kind `investment`

### Requirement: Snapshot reads lines

Nia's financial snapshot MUST resolve budgets from `budget_lines` using `computeBudgetMonth` with the same input rules as the web app (scope, income base and `base.source`, debt actuals). To compute debt actuals, Nia MUST load `debts` and `debt_events`; if they cannot be read it MUST pass `debtEvents` null and accept the `debt_data_unavailable` fallback. Snapshot figures MUST match the web app for the same month and scope. When `budget_lines` is missing, or empty while `budgets` has rows, Nia MUST use the legacy read-only fallback (see budget-migration) and MUST NOT fail.

#### Scenario: Matching numbers
- GIVEN the same month and household data
- THEN Nia's reported Por asignar and group actuals equal those in BudgetView

#### Scenario: Table missing
- GIVEN `budget_lines` does not exist and `budgets` has rows
- WHEN Nia builds the snapshot
- THEN it completes using the legacy amounts as one-month lines
- AND a budget write request is refused with the migration-pending message

### Requirement: Debt cost category

`COST_CATEGORY.kind` in `functions/nia/debt/handler.js` MUST be `'debt'`, so debt cost rows created by Nia are classified in the debt group.

#### Scenario: Cost row
- GIVEN Nia creates a debt cost category
- THEN its kind is `debt`
