# Delta for debt-web-management

## ADDED Requirements

### Requirement: More-actions menu

The debt detail MUST show a "Más acciones" menu with "Cambiar tasa", "Cambiar seguros y cargos", "Configurar mora" and "Reestructurar". For card debts the menu MUST omit "Reestructurar". Each action opens a dialog that writes through the shared commit flow and its exactly-once guard.

#### Scenario: Loan menu

- GIVEN a loan detail
- THEN the menu lists the four actions

#### Scenario: Card menu

- GIVEN a card detail
- THEN the menu lists "Cambiar tasa", "Cambiar seguros y cargos" and "Configurar mora", and not "Reestructurar"

### Requirement: Late policy dialog

"Configurar mora" MUST let the user set the debt's mora policy (none, usury, fixed rate or multiple of the contract rate, with optional grace days) from an effective date, writing a `late_policy` event. Mora MUST accrue only for days after that date (the day after the effective date is the first accruing day). The dialog MUST preview the mora accrued as of today under the new policy and MUST show the stale-cap notice when the legal table does not cover today.

#### Scenario: Enable usury mora on an existing loan

- GIVEN a loan with no mora policy and principal 199,505 overdue since 10 days before today, at a 28.59% EA usury cap
- WHEN the user enables `usury` effective 10 days ago and confirms
- THEN one `late_policy` event is written and the detail shows mora 1,375

#### Scenario: Effective today does not rewrite the past

- GIVEN the same loan
- WHEN the user enables mora effective today
- THEN the mora shown is 0 and earlier payments keep their cost rows

### Requirement: Rate change dialog

The dialog MUST collect an effective date, a rate with its convention (basis, periodicity, timing) and, for loans, `keep_term` or `keep_installment`. It MUST show the EA echo, the informational usury notice from the resolved table, and a live before/after preview from `previewChange`. A past effective date MUST show a warning that earlier costs may change and list the impacted payments. `keep_installment` MUST be offered only for French amortization. On `installment_too_low` the dialog MUST show a specific message and pre-select `keep_term`. Saving twice MUST create one event.

#### Scenario: Preview before save

- GIVEN a loan and a new rate of 2% monthly nominal
- THEN the dialog shows about 26.8% EA and the next installment before and after

#### Scenario: Installment too low

- GIVEN `keep_installment` with an installment below the new interest
- THEN the specific message is shown, `keep_term` is pre-selected and save does not write the failing choice

#### Scenario: Backdated

- GIVEN an effective date before a recorded payment
- THEN a warning lists that payment as impacted

#### Scenario: Double submit

- GIVEN the user taps Save twice
- THEN one `rate_change` event exists

### Requirement: Charge change dialog

The dialog MUST edit the charges as real charge objects (`kind`, `label`, `basis`, `value`, `cadence`, `fromPeriod`, `toPeriod`) through a charges editor. The edited set MUST replace the old set from the effective date. A `pctOfCharge` reference to a missing charge MUST be rejected with an inline message. It MUST show a before/after preview and the impacted past payments.

#### Scenario: Replace charges

- GIVEN a loan with a fixed fee of 10,000
- WHEN the editor changes it to 12,000 effective next month
- THEN the preview shows the new charge from that date only

#### Scenario: Dangling reference

- GIVEN an IVA charge referencing a removed fee
- THEN save is disabled with an inline message

### Requirement: Restructure dialog

The dialog MUST be a three-step flow. Step 1 shows the current arrears breakdown (principal, interest, charges, mora). Step 2 collects rate, system, periodicity, number of periods, first due date (strictly after the effective date), grace or balloon, charges, and a "condonar mora" option shown only when mora is greater than 0. Step 3 shows before/after, the usury notice, and MUST block saving with a clear message when the event payload exceeds 8000 characters (`payload_too_large`). The new terms MUST carry the carried balance as principal and the effective date as the opening date.

#### Scenario: Three steps

- GIVEN a loan with arrears including mora
- THEN step 1 shows the arrears and mora, and the carried balance equals their sum

#### Scenario: First due date

- GIVEN a first due date on or before the effective date
- THEN step 2 shows an inline error and does not advance

#### Scenario: Payload too large

- GIVEN terms whose payload exceeds 8000 characters
- THEN step 3 shows `payload_too_large` and disables save

#### Scenario: Waive mora

- GIVEN "condonar mora" checked
- THEN the summary excludes the mora from the carried balance

### Requirement: Plan-change history and void

The event history MUST show a one-line summary for plan-change events instead of an amount of 0: for `rate_change` old and new EA, mode and effective date; for `charge_change` the labels of the changed charges; for `restructure` the carried balance and new number of periods; for `late_policy` the mode. Rate-change, charge-change and mora-policy events MUST be voidable with confirmation. A restructure MUST be voidable only through the guarded flow of the ledger, and the UI MUST name the blocking events when blocked. After any save or void of a plan-change event, cost rows MUST be reconciled and a toast MUST report the number of rows changed.

#### Scenario: Summary

- GIVEN a recorded `rate_change` from 24% to 20% EA
- THEN the history shows both values and the effective date, not "$ 0"

#### Scenario: Blocked restructure void

- GIVEN a restructure followed by a payment
- WHEN the user tries to void the restructure
- THEN the UI explains that the payment blocks it and writes nothing

#### Scenario: Reconcile toast

- GIVEN a backdated rate change that changes two cost rows
- WHEN it is saved
- THEN reconcile runs and a toast reports 2 rows updated

## MODIFIED Requirements

### Requirement: Create wizard

The wizard MUST collect kind, lender, principal, rate with its convention (basis, periodicity, timing), system, term, grace, charges, mora policy, ownerScope and opening date. It MUST show the EA equivalent and the first installment before saving, and warn (not block) above the usury cap resolved from the household legal table. The mora policy MUST default by kind (see `late-interest`) and MAY be changed; a `fixed` choice MUST ask for a rate.
(Previously: no mora policy; the usury cap came from the code table only.)

#### Scenario: Rate echo

- GIVEN 2.1% monthly nominal entered
- THEN the wizard shows about 28.3% EA

#### Scenario: Interest-free plan

- GIVEN rate 0% and manual or French terms
- WHEN saved
- THEN the debt is created and its schedule has zero interest

#### Scenario: Validation

- GIVEN a negative principal or an invalid anticipated rate
- THEN save is disabled with an inline message

#### Scenario: Mora default

- GIVEN kind "family"
- THEN the mora selector is preset to none; for kind "consumer" it is preset to usury

#### Scenario: Household cap used

- GIVEN a household cap of 29.00 for the month
- WHEN a 29.50% EA debt is entered
- THEN the warning cites 29.00 and saving is still allowed

### Requirement: Detail and plan

The detail MUST show state, the schedule with paid/due/past-due markers, real-cost totals, charge lines or bundled totals, and the event history including voided events. For overdue rows with mora on, it MUST show the mora amount, the days and the base, and the totals MUST include the outstanding mora. When legal-table notices apply (`late_cap_stale`, `late_cap_unknown`, `late_mortgage_unverified`), they MUST be shown as informational.
(Previously: no mora information or legal notices.)

#### Scenario: Schedule markers

- GIVEN 3 payments recorded on a 12-installment loan
- THEN rows 1-3 are paid, row 4 is next due, and the closing balance of the last row is 0

#### Scenario: Overdue with mora

- GIVEN a row of principal 199,505 overdue 10 days with mora on at 28.59% EA
- THEN the row shows mora 1,375, 10 days and base 199,505
- AND past-due total includes the 1,375

#### Scenario: Stale cap notice

- GIVEN a carried-forward cap
- THEN the detail shows the stale notice without blocking any action

### Requirement: Record payment

The payment form MUST show the allocation preview (charges, late interest, interest, principal), the resulting balance and the cost expense to be created. When the amount exceeds the installment it MUST require a strategy. Submitting twice MUST create one event.
(Previously: the preview had no late-interest bucket.)

#### Scenario: Preview matches saved

- GIVEN a preview of principal 199,505 and cost 190,876
- WHEN confirmed
- THEN the saved event and expense equal the preview

#### Scenario: Preview with mora

- GIVEN the installment 390,381 paid 10 days late at 28.59% EA
- THEN the preview shows charges 10,000, mora 1,375, interest 180,876, principal 198,130 and a cost of 192,251

#### Scenario: Double submit

- GIVEN the user taps Save twice
- THEN one event and at most one expense exist

#### Scenario: Void

- GIVEN a recorded payment
- WHEN the user voids it with confirmation
- THEN the balance returns to its prior value and its expense row is deleted
