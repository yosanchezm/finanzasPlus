# Late Interest Specification

## Purpose

Late interest (mora) on overdue principal under Colombian rules. Figures are informational; the bank's statement wins. Out of scope: collection fees (users enter them in `bankSplit.charges`), automatic fetching of Superfinanciera data, and Ley 546/1999 mortgage rules (flagged only).

## Requirements

### Requirement: Mora policy and modes

A debt MAY carry `terms.late = {mode, rate?, multiple?, modality?, graceDays?, since?}`. An absent `terms.late` MUST mean mode `none`. Modes:

| Mode | Annual rate before cap |
|---|---|
| `none` | No mora is computed. Values the bank reports in `bankSplit.lateInterest` still apply. |
| `usury` | The usury cap of each day for the debt's modality |
| `fixed` | `rate` (EA) |
| `contract_multiple` | `multiple` × the contract EA |

`terms.modality` MUST override the modality derived from the debt kind (kind `mortgage` derives `mortgage`; other bank kinds derive `consumer`). `graceDays` MUST be an integer ≥ 0. A `fixed` mode without a rate > 0, or a `contract_multiple` without a multiple > 0, MUST be rejected with a typed validation error.

#### Scenario: Absent policy

- GIVEN a debt with no `terms.late`
- THEN its mode is `none` and no mora accrues

#### Scenario: Invalid policy

- GIVEN mode `fixed` with no rate
- WHEN the terms are validated
- THEN a typed validation error is returned

#### Scenario: Bank-reported mora under none

- GIVEN mode `none` and a payment with `bankSplit.lateInterest` of 5,000
- THEN 5,000 is allocated as late interest and no mora is computed

### Requirement: Defaults by kind for new debts

New debts created from the wizard or Nia MUST receive a default mora mode by kind: `consumer`, `vehicle`, `libranza`, `leasing`, `card` and `mortgage` → `usury`; `family`, `informal` and `other` → `none`. A user MAY choose another mode, including `fixed` for family and informal loans. Existing debts MUST NOT change. A `mortgage` debt with mora MUST carry an informational notice `late_mortgage_unverified` (Ley 546/1999 rules not applied).

#### Scenario: Bank loan default

- GIVEN a new `consumer` debt
- THEN its default mora mode is `usury`

#### Scenario: Family loan default

- GIVEN a new `family` debt
- THEN its default mora mode is `none` and an overdue installment accrues 0

#### Scenario: Existing debts untouched

- GIVEN a debt created before this change
- THEN its mora mode is `none` until a `late_policy` event is recorded

### Requirement: Accrual base excludes interest

Mora MUST accrue on the unpaid principal of rows whose due date has passed, and only on it. Interest, charges, taxes, capitalized grace interest and mora itself MUST NOT accrue mora (no anatocism). On overdue principal, mora MUST replace regular interest; both MUST NOT be charged for the same days.

#### Scenario: Only principal

- GIVEN an installment of principal 199,505, interest 180,876 and charges 10,000, all unpaid and overdue
- THEN the accrual base is 199,505

#### Scenario: Partial payment lowers the base

- GIVEN 199,505 overdue and 107,749 of principal paid on day 10
- THEN from day 10 the base is 91,756

### Requirement: Window and daily rate

Mora MUST accrue per row for `max(0, paymentOrAsOfDate − dueDate − graceDays)` days, using actual/365. The simple daily rate MUST be `(1+EA)^(1/365) − 1`, where EA is the annual rate after the daily cap. Accrual MUST be split into segments at events, cap boundaries, contract-rate changes and the projection date. The system MUST keep an exact accumulator and round once when exposing a value.

#### Scenario: Ten days at 28.59% EA

- GIVEN a base of 199,505 and a daily rate of 0.00068917
- WHEN 10 days are overdue
- THEN the daily mora is 137.49 and the mora is 1,375

#### Scenario: Thirty days

- GIVEN the same base
- WHEN 30 days are overdue
- THEN the mora is 4,125

#### Scenario: Grace days

- GIVEN `graceDays` of 3 and an installment 10 days overdue
- THEN mora accrues for 7 days

### Requirement: Cap applies per day

For each day, EA MUST equal `min(policy rate, usury cap of that day for the modality)`. For mode `usury` the policy rate is the cap itself. When the cap is carried forward, a notice `late_cap_stale` MUST be raised. When no cap is known at all, mora MUST use the policy rate (the contract EA for mode `usury`) and a notice `late_cap_unknown` MUST be raised. Neither notice may block.

#### Scenario: Cap changes mid-way

- GIVEN a base of 199,505, a cap of 28.59% for days 1-5 and an illustrative cap of 27.50% for days 6-10
- THEN the mora is 687.46 + 664.18 = 1,351.64, rounded once to 1,352

#### Scenario: Fixed rate above the cap

- GIVEN mode `fixed` at 40% EA and a cap of 28.59%
- THEN the mora equals that of mode `usury`

#### Scenario: Stale cap

- GIVEN the last known cap ended before the accrual date
- THEN the last cap is used and `late_cap_stale` is raised

### Requirement: Projection exposes mora

`project()` MUST accrue mora before each event and at `asOf`. Outstanding for a row MUST include its accrued, unpaid mora, so `dueNow` and `pastDueMinor` include it. The projection MUST expose `lateInterestMinor` and `totals.remainingLateInterest`. A payment MUST pay mora before regular interest and principal.

#### Scenario: Past due includes mora

- GIVEN an installment of 390,381 (charges 10,000, interest 180,876, principal 199,505) 10 days overdue at 28.59% EA
- THEN `pastDueMinor` is 391,756

#### Scenario: Pay the installment on day 10

- GIVEN the same installment
- WHEN 390,381 is paid
- THEN the split is charges 10,000, mora 1,375, interest 180,876, principal 198,130
- AND principal of 1,375 stays overdue

#### Scenario: Short payment

- GIVEN the same installment
- WHEN 100,000 is paid on day 10
- THEN the split is charges 10,000, mora 1,375, interest 88,625, principal 0

#### Scenario: Larger payment

- GIVEN the same installment
- WHEN 300,000 is paid on day 10
- THEN principal paid is 107,749
- AND the next 10 days accrue 632 on 91,756

### Requirement: late_policy event

A dated `late_policy {late}` event MUST set or replace the mora policy for a debt from its effective date. Mora MUST accrue only for days after that date (the day after the effective date is the first accruing day), never retroactively. The latest non-voided `late_policy` with effective date ≤ the day applies. The event MUST be replayable and voidable. Writes MUST be exactly-once through the debt's `dedupeKey`.

#### Scenario: No retroactive mora

- GIVEN an installment 20 days overdue and a `late_policy` (`usury`) effective today
- THEN mora accrued today is 0
- AND five days later it covers 5 days

#### Scenario: Void

- GIVEN a `late_policy` that has been voided
- THEN the projection equals the one before the event

### Requirement: Mora invariants

For any inputs mora MUST be: ≥ 0; non-decreasing in days; zero when the base is 0, the mode is `none`, or EA is 0; never above the cap rate; independent of the interest, charges and taxes of the row; and independent of where an extra segment boundary is inserted (±1 peso). A debt without any mora policy MUST project exactly as before this change: every pre-existing field is identical and all mora fields are 0.

#### Scenario: Path independence

- GIVEN a 30-day overdue base
- WHEN an extra no-op boundary is inserted on day 12
- THEN the total differs by at most 1 peso

#### Scenario: Golden parity

- GIVEN a debt without `terms.late` or `late_policy`
- THEN its projection deep-equals the pre-change golden for all pre-existing fields
