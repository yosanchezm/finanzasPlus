# Delta for debt-ledger

Base: `debt-management` and `debt-plan-changes` (latest text quoted below).

## ADDED Requirements

### Requirement: Terms correction event

The ledger MUST support an additive `terms_correction` event that corrects data that was wrong from the start. It MAY carry: for cards, statement day (1-31), due day (1-31) and minimum-payment rule, percentage and floor; for any debt, the rate with its convention as the bank states it, and the modality. A draft with no field, an out-of-range value, a field not applicable to the debt kind, an unsupported field (card limit, advance rate, `prepaymentPenaltyPct`, `allocationOrder`, mora base) or a value equal to the current one MUST return a typed validation error and write nothing. The payload MUST fit the existing event payload limit. The event MUST be append-only.

#### Scenario: Valid card correction

- GIVEN a card with statement day 15
- WHEN a correction to day 20 is validated
- THEN it is accepted

#### Scenario: Field not applicable

- GIVEN a loan and a statement day
- THEN a typed error is returned and nothing is written

#### Scenario: Unsupported field

- GIVEN a draft carrying the card limit
- THEN a typed error is returned and nothing is written

#### Scenario: No change

- GIVEN a draft equal to the stored terms
- THEN a typed `no_change` error is returned

### Requirement: Retroactive replay

A recorded `terms_correction` MUST apply as if the corrected values had held from the start of the terms version in force when it was recorded, regardless of the event date. When several corrections touch the same field, the latest non-voided one MUST win. Later `rate_change` events keep their own rates. The projection MUST remain deterministic and independent of storage order.

#### Scenario: Rate convention corrected

- GIVEN a debt saved as 28.32% EA that the bank states as 25.2% NAMV
- WHEN the correction is recorded
- THEN the projection uses 2.1% per month from the first installment, and the EA equivalent is about 28.32%

#### Scenario: Later rate change intact

- GIVEN a `rate_change` to 22% EA before the correction
- THEN after the correction the rate in force is still 22% EA

#### Scenario: Two corrections

- GIVEN two corrections of the statement day, the second later
- THEN the second value applies, and voiding it restores the first

### Requirement: Terms correction preview

`previewChange` MUST accept `terms_correction` drafts. It MUST return before and after values of the corrected fields and of the next installment or statement, plus `impacted`: the past events and statements whose cost would change, each with cost before and after. The preview MUST equal the projection obtained after the event is saved.

#### Scenario: Preview equals saved result

- GIVEN a correction draft
- WHEN it is previewed and then saved
- THEN the projection equals the preview's `after`

#### Scenario: Impacted past costs

- GIVEN a payment recorded under the wrong minimum rule
- THEN `impacted` lists it with its cost before and after

### Requirement: Terms correction void, reconcile and summary

A `terms_correction` MUST be voidable, and the projection after the void MUST equal the one before the correction. After a save or void, cost rows MUST be reconciled, once and idempotently, as for plan changes. A one-line summary MUST list each changed field with old and new values.

#### Scenario: Void restores

- GIVEN a recorded correction
- WHEN a member voids it
- THEN the projection equals the one before the correction and cost rows are reconciled

#### Scenario: Summary

- GIVEN a correction of statement day 15 to 20
- THEN the summary names the field and shows 15 and 20

### Requirement: Older bundles skip the correction

A core that does not know `terms_correction` MUST skip it with an `unknown_event_kind` notice, keeping the debt readable on the uncorrected terms. The web and Nia MUST be released together so that no stale bundle is left reading uncorrected terms.

#### Scenario: Old core

- GIVEN a debt with a `terms_correction` and a core that does not know the kind
- THEN the debt projects on its original terms with the notice, and nothing throws

## MODIFIED Requirements

### Requirement: Append-only debts and events

A debt MUST store household, name, kind, ownerScope, lender, status, currency, principal, opening date and versioned terms. Events (`disbursement`, `payment`, `extra_payment`, `rate_change`, `charge_change`, `restructure`, `late_policy`, `terms_correction`, `adjustment`, `void`) MUST be append-only and never edited. Any household member MAY record or void events; `actorId` MUST be stored. Interest-free family loans, with or without a plan, MUST be supported.
(Previously: the event list did not include `terms_correction`.)

#### Scenario: Correction by void

- GIVEN a recorded payment event
- WHEN a member voids it
- THEN a `void` event referencing it is appended and the original row is unchanged

#### Scenario: Family loan without plan

- GIVEN a 0% debt of kind "informal" with manual terms
- WHEN payments of arbitrary amounts and dates are recorded
- THEN the balance equals principal minus applied payments and never goes below 0

#### Scenario: Late policy event is append-only

- GIVEN a recorded `late_policy` event
- WHEN a member changes the policy again
- THEN a new `late_policy` event is appended and the first is unchanged

#### Scenario: Terms correction is append-only

- GIVEN a recorded `terms_correction`
- WHEN a member corrects the same field again
- THEN a new `terms_correction` is appended and the first is unchanged
