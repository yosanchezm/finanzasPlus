# Delta for debt-web-management

## ADDED Requirements

### Requirement: Navigation and list

The app MUST expose a "Debts" entry in the sidebar, mobile tab/more sheet and shell, lazy-loaded. The list MUST show each debt (name, lender, balance, next installment and due date, EA rate) filtered by ownerScope, plus totals for balance and monthly obligation. Debts MUST NOT be month-scoped.

#### Scenario: Open view

- GIVEN a member with two debts
- WHEN they open Debts on desktop or mobile
- THEN both are listed and totals equal the sum of the projected balances

#### Scenario: Scope filter

- GIVEN a debt owned by another member's personal scope
- WHEN the list loads
- THEN that debt is not shown

#### Scenario: Empty

- GIVEN no debts
- THEN an empty state with a create action is shown

### Requirement: Create wizard

The wizard MUST collect kind, lender, principal, rate with its convention (basis, periodicity, timing), system, term, grace, charges, ownerScope and opening date. It MUST show the EA equivalent and the first installment before saving, and warn (not block) above the usury cap.

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

### Requirement: Detail and plan

The detail MUST show state, the schedule with paid/due/past-due markers, real-cost totals, charge lines or bundled totals, and the event history including voided events.

#### Scenario: Schedule markers

- GIVEN 3 payments recorded on a 12-installment loan
- THEN rows 1-3 are paid, row 4 is next due, and the closing balance of the last row is 0

### Requirement: Record payment

The payment form MUST show the allocation preview (charges, interest, principal), the resulting balance and the cost expense to be created. When the amount exceeds the installment it MUST require a strategy. Submitting twice MUST create one event.

#### Scenario: Preview matches saved

- GIVEN a preview of principal 199,505 and cost 190,876
- WHEN confirmed
- THEN the saved event and expense equal the preview

#### Scenario: Double submit

- GIVEN the user taps Save twice
- THEN one event and at most one expense exist

#### Scenario: Void

- GIVEN a recorded payment
- WHEN the user voids it with confirmation
- THEN the balance returns to its prior value and the expense is voided

### Requirement: Extra-payment simulator

The simulator MUST accept an amount and show the strategies side by side with the verdict and its reason. It MUST NOT write data until the user converts it to a payment.

#### Scenario: Convert

- GIVEN a simulation for 2,000,000 reduce term
- WHEN the user chooses "Record as payment"
- THEN the payment form opens prefilled with that amount and strategy

### Requirement: Failure handling

Load or save failures MUST show an error with retry and MUST NOT display partial or stale balances as confirmed.

#### Scenario: Save error

- GIVEN the event write fails
- THEN an error is shown and the projection is unchanged
