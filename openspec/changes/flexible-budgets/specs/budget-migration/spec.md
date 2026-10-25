# Delta for budget-migration

## ADDED Requirements

### Requirement: Budget lines schema

`migrate:appwrite` MUST create a `budget_lines` table through a new `scripts/lib/budget-schema.mjs` (`withBudgetSchema`), following the existing schema-chain pattern. It MUST store `householdId`, the target (`targetType`, `targetId`), the rule (`rule`, `amountMinor`, `percentBp`), `fromMonth` and `toMonth`, with the columns and names of the Naming table and schema in `design.md`. Re-running the script MUST NOT fail or duplicate the table. The `budgets` table MUST remain untouched and MUST NOT be deleted.

#### Scenario: Idempotent schema
- GIVEN the table already exists
- WHEN `migrate:appwrite` runs again
- THEN no error occurs and nothing changes

### Requirement: Dry run by default

The budget migration script MUST run as a dry run unless `--apply` is passed. A dry run MUST perform no writes and MUST report: legacy rows read, lines to create, lines already present, rows skipped with reason, the seeded plan lines, duplicate legacy rows resolved by the tie-break, and the cost-category patches.

#### Scenario: Dry run
- GIVEN 40 legacy budget rows
- WHEN run without `--apply`
- THEN the report states the 1:1 mapping and the database is unchanged

### Requirement: Row mapping and deterministic ids

Each `budgets` row MUST map to exactly one one-month line: `targetType` `category`, `targetId` = the row's `categoryId`, rule `fixed` with `amountMinor` = the row's `plannedMinor`, `fromMonth` = `toMonth` = row month, and `$id` = `bl{budgetId}`. The following rows MUST be skipped and reported with their reason: a row referencing a missing category, a row lacking a month, a row with `plannedMinor` 0, a row whose category has kind `income`, and a row whose `bl{budgetId}` would exceed 36 characters.

Ids written by the web app and Nia MUST be deterministic and at most 36 characters: `bo` (one month) or `br` (from this month on) + `YYYYMM` + the 16-hex-digit FNV-1a 64-bit hash of the target key, as defined in the Row ids section of `design.md`.

#### Scenario: 1:1 mapping
- GIVEN a budget row id `abc`, category Mercado, month `2026-09`, `plannedMinor` 900000
- THEN the line `blabc` is planned with fixed 900000 from `2026-09` to `2026-09`

#### Scenario: Zero and income rows skipped
- GIVEN a row with `plannedMinor` 0 and a row on an `income`-kind category
- THEN neither is planned and both are reported as skipped with their reason

### Requirement: Idempotent apply

On `--apply`, a line whose `$id` already exists MUST be skipped, never overwritten, so user edits made after a first run survive. Re-running MUST create zero duplicates. An interrupted run MUST be safely resumable by re-running.

#### Scenario: Re-run
- GIVEN a completed apply
- WHEN `--apply` is run again
- THEN zero lines are created and zero are modified

#### Scenario: Resume
- GIVEN an apply that stopped after 10 of 40 lines
- WHEN re-run
- THEN only the missing 30 lines are created

### Requirement: Plan seeding (A3)

The migration MUST also seed an open-ended recurring plan from the latest budgeted month M (the greatest month among mapped rows, after skips): for each category with a mapped row in M, one fixed open-ended line with the amount of that row, `fromMonth` = M+1, `toMonth` null, and `$id` = `bs{YYYYMM of M+1}{hash}` where the hash is taken over the category's target key (keyed by category, not by budget row). When a category has several mapped rows in M, the resolution tie-break (budget-plan) MUST pick one, and the others MUST be reported as duplicates. Seeding MUST follow the same skip-if-exists rule. When there are no mapped rows, nothing MUST be seeded. The seeded plan MUST be reported separately in the dry-run output so it can be reviewed before apply.

#### Scenario: Plan seeded
- GIVEN the latest budgeted month is `2026-10` with 5 categories
- THEN 5 open-ended lines from `2026-11` are planned with ids `bs202611{hash}`, one per category

#### Scenario: Duplicate rows in M
- GIVEN two rows for Mercado in `2026-10`, ids `a1` (700000) and `a2` (900000)
- THEN the seed for Mercado uses 900000 (`bla2` wins the tie-break) and the duplicate is reported

### Requirement: Backup before writes

On `--apply`, before any write, the script MUST write a timestamped backup JSON containing the raw legacy `budgets` rows, every matched cost category row (before the patch) and the existing `budget_lines` ids. If the backup cannot be written, the script MUST abort without writing.

#### Scenario: Backup failure
- GIVEN the backup directory is not writable
- WHEN `--apply` runs
- THEN the script aborts and no line is written

### Requirement: Cost category kind patch

The migration MUST update every existing "Costos financieros" category (matched ignoring case and accents, archived ones included) whose kind is not `debt` to kind `debt`. Re-running MUST be a no-op. `COST_CATEGORY.kind` in `src/appwrite.js` and `functions/nia/debt/handler.js` MUST be `'debt'` for newly created cost categories.

#### Scenario: Patch
- GIVEN a "Costos financieros" category with kind `need`
- WHEN applied
- THEN its kind becomes `debt`; a second run changes nothing

### Requirement: Legacy read-only fallback

The web app and Nia MUST use legacy mode when the `budget_lines` table is missing (HTTP 404 / table-not-found), or when it has no rows while the legacy `budgets` table has at least one row. In legacy mode they MUST read the legacy `budgets` rows as one-month fixed lines (the same mapping as the migration), MUST NOT throw, MUST still load the workspace, and MUST disable budget editing with a message that the migration is pending. An empty `budget_lines` table with no legacy rows MUST be treated as normal mode (editing enabled). The migration script MUST abort in apply mode, with a message to run `migrate:appwrite`, when the table is missing.

#### Scenario: Table not yet created
- GIVEN `budget_lines` does not exist and `budgets` has rows
- WHEN the workspace loads
- THEN no error is shown, budgets show the legacy amounts, and editing is disabled with the migration message

#### Scenario: Table created but not migrated
- GIVEN `budget_lines` exists with no rows and `budgets` has rows
- WHEN the workspace loads
- THEN the legacy amounts are shown read-only

#### Scenario: New household
- GIVEN `budget_lines` exists with no rows and `budgets` has no rows
- THEN editing is enabled

#### Scenario: Apply without table
- GIVEN `budget_lines` does not exist
- WHEN the migration runs with `--apply`
- THEN it aborts with the `migrate:appwrite` message and writes nothing

### Requirement: Rollout order

The web app and Nia releases that read `budget_lines` MUST be deployed only after the migration has run with `--apply`.

#### Scenario: Deploy order
- GIVEN the schema exists and the migration has not been applied
- THEN the web deploy waits until `--apply` completes
