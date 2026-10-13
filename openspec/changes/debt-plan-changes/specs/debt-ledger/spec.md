# Delta for debt-ledger

## ADDED Requirements

### Requirement: Forward-compatible event handling

When reading or projecting, the core MUST tolerate event kinds it does not recognize: it MUST skip the event, MUST add a notice `unknown_event_kind` carrying the event id and kind, and MUST NOT throw. The debt MUST remain readable and every recognized event MUST project as if the unknown one were absent. A `void` that references an unknown event MUST be ignored without error. Writing an event of an unknown kind through the write path MUST still be rejected. This tolerance MUST be released before, or in the same release as, the first build that can write `late_policy`.

#### Scenario: Bundle older than the data

- GIVEN a debt whose history contains a `late_policy` event and a core that does not know that kind
- WHEN the debt is projected
- THEN the projection of the known events is returned with an `unknown_event_kind` notice
- AND nothing throws and the debt is not marked unreadable

#### Scenario: Unknown kind on write

- GIVEN a draft event with an unrecognized kind
- WHEN it is validated for saving
- THEN a typed validation error is returned and nothing is written

### Requirement: Plan change preview

`previewChange(debt, events, draft, {on})` MUST be pure and read-only and MUST accept drafts of kind `rate_change`, `charge_change`, `restructure` and `late_policy`. It MUST return `before` and `after` values for next installment, remaining periods, last due date and remaining cost, plus `impacted`: the past events whose cost would change, each with its cost before and after. An infeasible draft MUST return a typed error instead of throwing: `installment_too_low` when `keep_installment` does not cover the new interest or the plan would exceed 2000 periods. The preview MUST equal the projection obtained after the event is saved.

#### Scenario: Preview equals saved result

- GIVEN a `rate_change` draft with `keep_term`
- WHEN the preview is shown and then the event is saved
- THEN the projection's next installment, remaining periods and remaining cost equal the preview's `after`

#### Scenario: Installment too low

- GIVEN a `rate_change` draft with `keep_installment` whose installment is below the new periodic interest
- THEN the preview returns `installment_too_low` and no event is written

#### Scenario: Backdated change

- GIVEN a payment recorded on 2026-08-05
- WHEN a rate change effective 2026-07-01 is previewed
- THEN `impacted` lists that payment with its cost before and after

### Requirement: Restructure capitalizes arrears

A `restructure` MUST refinance everything unpaid on rows due on or before its effective date: principal, interest, charges and taxes, and accrued mora. The carried balance MUST equal that total. With `waiveLate: true` the accrued, unpaid mora MUST be excluded from the carried balance and forgiven, and no cost row MUST be created for it. After the restructure no mora MUST accrue on the replaced rows. The new terms version MUST inherit the previous mora policy unless the draft sets another. The projection MUST remain deterministic.

#### Scenario: Arrears capitalized with mora

- GIVEN the installment of 390,381 unpaid 10 days overdue at 28.59% EA
- WHEN a restructure is recorded on day 10
- THEN the carried balance is 391,756

#### Scenario: Waive mora

- GIVEN the same debt
- WHEN the restructure sets `waiveLate`
- THEN the carried balance is 390,381

### Requirement: Void rules for plan-change events

`rate_change`, `charge_change` and `late_policy` events MUST be voidable; the projection after the void MUST equal the one before the event. A `restructure` MUST be voidable only through a guarded flow that requires explicit confirmation and MUST be blocked when any later non-voided payment, extra payment or plan-change event exists. A blocked void MUST name the blocking events and write nothing.

#### Scenario: Void a rate change

- GIVEN a recorded `rate_change`
- WHEN a member voids it
- THEN the projection equals the one before the change

#### Scenario: Restructure with later payments

- GIVEN a restructure followed by a payment
- WHEN a member tries to void the restructure
- THEN the void is blocked, the blocking payment is named, and no `void` event is written

#### Scenario: Restructure without later events

- GIVEN a restructure with no later events
- WHEN a member confirms the guarded void
- THEN a `void` event is appended and the previous terms version applies again

### Requirement: Cost rows follow plan changes

After a `rate_change`, `charge_change`, `restructure`, `late_policy` or void that alters the cost of earlier payments, the cost expense rows MUST be reconciled so each equals its payment's projected cost: created, corrected or deleted, once and idempotently. Reconcile MUST run after the save in the web. A change made where reconcile does not run MUST leave rows to the next reconcile, which MUST repair them.

#### Scenario: Backdated rate change

- GIVEN a payment whose cost row is 190,876 and a backdated change that makes its cost 185,000
- WHEN the change is saved and reconcile runs
- THEN the row is 185,000

#### Scenario: Reconcile twice

- GIVEN reconcile already ran
- WHEN it runs again
- THEN no row changes

## MODIFIED Requirements

### Requirement: Append-only debts and events

A debt MUST store household, name, kind, ownerScope, lender, status, currency, principal, opening date and versioned terms. Events (`disbursement`, `payment`, `extra_payment`, `rate_change`, `charge_change`, `restructure`, `late_policy`, `adjustment`, `void`) MUST be append-only and never edited. Any household member MAY record or void events; `actorId` MUST be stored. Interest-free family loans, with or without a plan, MUST be supported.
(Previously: the event list did not include `late_policy`.)

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

### Requirement: Payment allocation

A payment MUST be allocated by `allocationOrder`, default: charges and taxes, late interest, current interest, principal. Late interest MUST be the mora accrued and unpaid at the payment date. A short payment MUST leave the unpaid remainder due and MUST NOT reduce principal before earlier buckets are covered.
(Previously: late interest was always 0; the order was unchanged.)

#### Scenario: Short payment

- GIVEN an installment with charges 10,000, interest 180,876 and principal 199,505
- WHEN 100,000 is paid
- THEN charges 10,000 and interest 90,000 are covered, principal paid is 0
- AND 90,876 of interest and the unpaid principal remain due

#### Scenario: Exact payment

- GIVEN a payment equal to the installment
- THEN the buckets equal the schedule row and allocated total equals the amount

#### Scenario: Mora paid before interest

- GIVEN the same installment 10 days overdue at 28.59% EA (mora 1,375)
- WHEN 100,000 is paid
- THEN charges 10,000, mora 1,375, interest 88,625 and principal 0 are covered

#### Scenario: Installment paid late

- GIVEN the same installment 10 days overdue
- WHEN 390,381 is paid
- THEN charges 10,000, mora 1,375, interest 180,876 and principal 198,130 are covered
- AND 1,375 of principal remains overdue

### Requirement: Cost-only expense rows

Each payment MUST create at most one `transactions` expense row with `source: 'debt'`, `debtId`, `dedupeKey = debt:{eventId}`, category "Costos financieros" (get-or-create) and ownerScope inherited from the debt. Its amount MUST equal interest + late interest + charges + taxes. Principal MUST NOT create an expense. A payment with zero cost creates no row. Voiding a payment MUST delete its expense row (the `void` event is the audit trail), so aggregations stop counting it. Loan disbursements MUST NOT create income.
(Previously: the amount was interest + charges + taxes, with no late interest.)

#### Scenario: Cost row amount

- GIVEN a payment split into charges 10,000, interest 180,876, principal 199,505
- WHEN recorded
- THEN one expense of 190,876 is written with the debt's ownerScope

#### Scenario: Cost row includes mora

- GIVEN a payment split into charges 10,000, mora 1,375, interest 180,876 and principal 198,130
- WHEN recorded
- THEN one expense of 192,251 is written

#### Scenario: Retry exactly once

- GIVEN a payment already recorded with `dedupeKey debt:abc`
- WHEN the same write is retried
- THEN no second event and no second expense row exist

#### Scenario: Atomic or reconcilable

- GIVEN the event write succeeds but the row write fails
- WHEN the debt is next read
- THEN the missing row is created once, idempotently
