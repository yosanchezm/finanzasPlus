# Delta for budget-plan

## ADDED Requirements

### Requirement: Money groups

The system MUST recognize six category kinds ("groups"): `income`, `need`, `want`, `saving`, `investment` and `debt`. `saving`, `investment` and `debt` MUST NOT be treated as consumption. Consumption MUST mean `need` plus `want`. Any category whose kind is missing or not one of the six MUST be classified as `need`.

#### Scenario: Legacy kind
- GIVEN a category with kind `"ocio"` (unknown)
- WHEN it is classified
- THEN its group is `need`

#### Scenario: New kinds are not consumption
- GIVEN categories of kind `saving`, `investment` and `debt`
- WHEN consumption is evaluated
- THEN none of them is consumption

### Requirement: Budget line shape

A budget line MUST have a target, a rule and a validity range. Column and result names follow the Naming table in `design.md`.
- Target: `targetType` (`category` or `group`) and `targetId` (a category `$id` or a group key). Both MUST be set.
- Rule: `rule` `fixed` with a non-negative integer `amountMinor`, or `rule` `percent` with an integer `percentBp` (0 to 10000 inclusive; 100 bp = 1%).
- Range: `fromMonth` (`YYYY-MM`, required) and `toMonth` (`YYYY-MM` or null = open-ended). `toMonth` MUST NOT be earlier than `fromMonth`.

A line with `toMonth` equal to `fromMonth` is a one-month line. An open-ended line is the recurring plan. Invalid lines MUST be rejected before any write.

#### Scenario: Valid percent line
- GIVEN `targetType` group, `targetId` `saving`, rule percent 2000 bp, fromMonth `2026-11`, toMonth null
- WHEN validated
- THEN it is accepted as a recurring plan line

#### Scenario: Invalid lines
- GIVEN a line with an unknown `targetType`, or a missing `targetId`, or `percentBp` 10001, or a negative `amountMinor`, or `toMonth` before `fromMonth`
- WHEN validated
- THEN it is rejected and nothing is written

### Requirement: No income targets

No budget line MAY target income. Validation MUST reject a line whose `targetType` is `group` with `targetId` `income`, and a line whose target category has kind `income`. Such lines MUST NOT be written by the web app, Nia or the migration.

#### Scenario: Income category rejected
- GIVEN a category "Salario" of kind `income`
- WHEN a line targeting it is validated
- THEN it is rejected and nothing is written

#### Scenario: Income group rejected
- GIVEN a line with `targetType` group and `targetId` `income`
- WHEN validated
- THEN it is rejected

### Requirement: Zero-amount lines are tombstones

A line that resolves to an amount of 0 MUST mean "no limit" for its target and period. It MUST shadow older lines like any other line, it MUST NOT be flagged `overBudget`, it MUST NOT count in Presupuesto usado, and a zero group line MUST be treated as "no envelope" for that group.

#### Scenario: Tombstone shadows the plan
- GIVEN an open-ended line from `2026-01` of 500000 and a one-month line of 0 for `2026-10`, same target
- WHEN resolving `2026-10`
- THEN the target has no limit and is not `overBudget` whatever its actual
- AND `2026-11` resolves to 500000

### Requirement: Line resolution per target and month

For a given target and month, the candidate lines MUST be those with `fromMonth <= month` and (`toMonth` null or `toMonth >= month`). Exactly one candidate MUST win, chosen deterministically in this order:
1. A one-month line for that month beats any other candidate.
2. Otherwise the greatest `fromMonth` wins.
3. On equal `fromMonth`, the line with a non-null `toMonth` (narrower) beats an open-ended one; between two bounded lines the smaller `toMonth` wins.
4. On any remaining tie, the lexicographically greatest line `$id` wins.

Resolution MUST NOT depend on array order or on read order from the backend. A target with no candidate has no budget for that month.

#### Scenario: Override beats plan
- GIVEN an open-ended line for category Mercado from `2026-01` of 800000 and a one-month line for `2026-10` of 950000
- WHEN resolving `2026-10`
- THEN 950000 wins
- AND resolving `2026-11` yields 800000

#### Scenario: Same fromMonth tie
- GIVEN an open-ended line and a one-month line, both with fromMonth `2026-10`, same target
- WHEN resolving `2026-10`
- THEN the one-month line wins

#### Scenario: Later plan supersedes
- GIVEN open-ended lines from `2026-01` (500000) and from `2026-06` (600000)
- WHEN resolving `2026-03` and `2026-07`
- THEN the results are 500000 and 600000

#### Scenario: Deterministic last tie-break
- GIVEN two lines identical in target, fromMonth and toMonth with ids `bl1` and `bl2`
- WHEN resolving in either input order
- THEN `bl2` wins both times

### Requirement: Editing preserves history

Editing a recurring line "from this month on" MUST close the existing line (`toMonth` = previous month of the edit) and open a new line from the edit month, so earlier months keep their previous values. If the existing line starts in the edit month, it MUST be updated in place instead. Lines starting after the edit month MUST be kept. Editing "this month only" MUST update the existing one-month line for that target and month whatever its id (including a migrated line), and MUST create a new one only when none exists, never duplicating it. Lines MUST NOT be hard-deleted by the app.

Removal MUST work as follows, for edit month M:
- "Quitar solo este mes" MUST write a one-month tombstone for (target, M), with the same update-or-create rule as a this-month edit.
- "Quitar desde este mes": when the covering open-ended line has `fromMonth` earlier than M, it MUST be closed at M−1; when it starts at M, it MUST be updated in place to an open-ended tombstone. An existing one-month line for (target, M) MUST also be set to 0. Lines starting after M MUST be kept.

#### Scenario: Remove from this month on
- GIVEN an open-ended line from `2026-01` of 500000
- WHEN the user removes it from `2026-07`
- THEN the line ends at `2026-06`, `2026-07` has no limit, and `2026-03` still resolves to 500000

#### Scenario: Remove a plan that starts this month
- GIVEN an open-ended line from `2026-07` of 600000 and an older line closed at `2026-06`
- WHEN the user removes it from `2026-07`
- THEN the `2026-07` line becomes an open-ended tombstone and `2026-07` onward has no limit

#### Scenario: Remove only this month
- GIVEN an open-ended line from `2026-01` of 500000
- WHEN the user removes it for `2026-10` only
- THEN a one-month tombstone for `2026-10` exists and `2026-11` resolves to 500000

#### Scenario: Migrated one-month line reused
- GIVEN a migrated one-month line `blabc` for Mercado `2026-10`
- WHEN the user edits Mercado for `2026-10` only
- THEN `blabc` is updated and no other one-month line for Mercado `2026-10` exists

#### Scenario: Edit from this month on
- GIVEN an open-ended line from `2026-01` of 500000
- WHEN the user sets 600000 from `2026-07`
- THEN the old line ends at `2026-06` and a new open-ended line starts at `2026-07`
- AND `2026-03` still resolves to 500000

#### Scenario: Repeated this-month edit
- GIVEN a one-month line for Mercado `2026-10`
- WHEN the user edits it again for the same month
- THEN the same line is updated and no second one-month line exists

### Requirement: Hogar-only editing

Lines MUST be created and edited only when the active scope is the household total (Hogar). In the personal ("Tú") and partner ("Pareja") scopes the editor MUST be disabled or hidden, and the UI MUST state that editing requires Hogar. Lines are household-level and have no `ownerScope`.

#### Scenario: Edit blocked in personal scope
- GIVEN the scope is Tú
- WHEN the user opens the budget view
- THEN lines are shown read-only with a note to switch to Hogar to edit

### Requirement: Calendar-month "copy previous" removal

The "copy previous month" action MUST be removed. The recurring plan MUST apply to later months without any copy step.

#### Scenario: Future month inherits
- GIVEN an open-ended line from `2026-01`
- WHEN the user views `2027-03`
- THEN that line applies with no copy action
