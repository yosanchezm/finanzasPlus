# Delta for debt-ledger

## ADDED Requirements

### Requirement: Append-only debts and events

A debt MUST store household, name, kind, ownerScope, lender, status, currency, principal, opening date and versioned terms. Events (`disbursement`, `payment`, `extra_payment`, `rate_change`, `charge_change`, `restructure`, `adjustment`, `void`) MUST be append-only and never edited. Any household member MAY record or void events; `actorId` MUST be stored. Interest-free family loans, with or without a plan, MUST be supported.

#### Scenario: Correction by void

- GIVEN a recorded payment event
- WHEN a member voids it
- THEN a `void` event referencing it is appended and the original row is unchanged

#### Scenario: Family loan without plan

- GIVEN a 0% debt of kind "informal" with manual terms
- WHEN payments of arbitrary amounts and dates are recorded
- THEN the balance equals principal minus applied payments and never goes below 0

### Requirement: Deterministic projection

`project(terms, events, asOf)` MUST be pure, derive the state (balance, next due, past-due, remaining term, schedule) from events in chronological order, and ignore voided events. Dates are `YYYY-MM-DD`. No stored cache MAY be treated as source of truth.

#### Scenario: Void restores state

- GIVEN a projection P0 without a payment
- WHEN the payment is recorded and then voided
- THEN the projection equals P0 (excluding the void audit trail)

#### Scenario: Idempotent replay

- GIVEN the same event list in any storage order with identical dates
- WHEN projected twice
- THEN the results are deeply equal

### Requirement: Payment allocation

A payment MUST be allocated by `allocationOrder`, default: charges and taxes, late interest, current interest, principal. A short payment MUST leave the unpaid remainder due and MUST NOT reduce principal before earlier buckets are covered.

#### Scenario: Short payment

- GIVEN an installment with charges 10,000, interest 180,876 and principal 199,505
- WHEN 100,000 is paid
- THEN charges 10,000 and interest 90,000 are covered, principal paid is 0
- AND 90,876 of interest and the unpaid principal remain due

#### Scenario: Exact payment

- GIVEN a payment equal to the installment
- THEN the buckets equal the schedule row and allocated total equals the amount

### Requirement: Extra payments and rate changes

An `extra_payment` MUST carry a strategy: reduce term, reduce installment, or advance installments (no interest saving). A `rate_change` MUST apply from its effective date with `keep_term` or `keep_installment`. A `restructure` MUST start a new terms version.

#### Scenario: Reduce term (0%)

- GIVEN 1,200,000 at 0%, 12 installments of 100,000, 1 paid
- WHEN 300,000 extra is applied to reduce term
- THEN the installment stays 100,000 and 8 installments remain

#### Scenario: Reduce installment (0%)

- GIVEN the same debt and extra
- WHEN the strategy is reduce installment
- THEN 11 installments remain and the installment is about 72,727 (last absorbs residue)

### Requirement: Cost-only expense rows

Each payment MUST create at most one `transactions` expense row with `source: 'debt'`, `debtId`, `dedupeKey = debt:{eventId}`, category "Costos financieros" (get-or-create) and ownerScope inherited from the debt. Its amount MUST equal interest + charges + taxes. Principal MUST NOT create an expense. A payment with zero cost creates no row. Voiding a payment MUST void its row. Loan disbursements MUST NOT create income.

#### Scenario: Cost row amount

- GIVEN a payment split into charges 10,000, interest 180,876, principal 199,505
- WHEN recorded
- THEN one expense of 190,876 is written with the debt's ownerScope

#### Scenario: Retry exactly once

- GIVEN a payment already recorded with `dedupeKey debt:abc`
- WHEN the same write is retried
- THEN no second event and no second expense row exist

#### Scenario: Atomic or reconcilable

- GIVEN the event write succeeds but the row write fails
- WHEN the debt is next read
- THEN the missing row is created once, idempotently

### Requirement: Additive schema

`debts`, `debt_events` (unique `dedupeKey`) and an optional `transactions.debtId` MUST be added without altering existing columns or data. `termsJson` MUST include a `schemaVersion`.

#### Scenario: Migration rerun

- GIVEN the migration already ran
- WHEN it runs again
- THEN it makes no change and existing rows are intact
