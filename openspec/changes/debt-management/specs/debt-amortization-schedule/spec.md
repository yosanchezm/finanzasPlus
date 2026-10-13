# Delta for debt-amortization-schedule

## ADDED Requirements

### Requirement: Amortization systems

The core MUST generate a schedule from terms for: French (fixed installment), German (constant principal), bullet, interest-only with optional balloon, and manual. Amounts are integer pesos. Rounding residue MUST go to the last installment. For every system the principal column MUST sum to P (balloon included) and the final balance MUST be 0.

#### Scenario: French 10M at 24% EA, 36 months

- GIVEN P = 10,000,000, 24% EA, 36 monthly installments, no charges
- WHEN the schedule is generated
- THEN installment 1 interest is about 180,876 (±1) and the installment is 380,381 (±1)
- AND installments 1–35 are equal, the last differs by at most 36 pesos
- AND principal sums to 10,000,000 and the closing balance is 0

#### Scenario: German monotonicity

- GIVEN P = 1,200,000, 12 monthly installments
- WHEN generated
- THEN principal per installment is 100,000 ±1
- AND interest and total installment are non-increasing

#### Scenario: Interest-free French

- GIVEN P = 1,200,000, 0%, 12 installments
- WHEN generated
- THEN every installment is 100,000 and interest is 0

#### Scenario: Balloon

- GIVEN interest-only with balloon 5,000,000 at maturity
- WHEN generated
- THEN the last row's principal equals the balloon and the final balance is 0

### Requirement: Grace periods

A grace period MUST be total (interest capitalizes) or principal-only (interest paid, no principal). Total grace MUST increase the balance by the unpaid interest. Rows during grace MUST still be listed.

#### Scenario: Total grace

- GIVEN 2 months of total grace
- WHEN generated
- THEN the balance after grace exceeds P and payments start after grace
- AND the final balance is 0

#### Scenario: Principal-only grace

- GIVEN 3 months of principal-only grace
- WHEN generated
- THEN grace rows have principal 0 and interest > 0 (when rate > 0)

### Requirement: Per-installment charges

Each charge `{kind, label, basis, value, cadence, fromPeriod, toPeriod}` MUST apply only within its period range and cadence. Bases: `fixed`, `pctOutstanding`, `pctOriginal`, `pctOfBase`, `pctOfSubtotal` (e.g. GMF), `pctOfCharge` (e.g. IVA). Charges MAY be bundled into the installment or listed as separate lines; both MUST be supported. A charge MUST NOT change principal amortization.

#### Scenario: GMF on subtotal

- GIVEN an installment subtotal of 400,000 and a GMF charge of 0.4% of subtotal
- WHEN the row is built
- THEN the GMF line is 1,600

#### Scenario: IVA on a fee

- GIVEN a fixed fee of 10,000 and an IVA charge of 19% of that fee
- WHEN the row is built
- THEN the IVA line is 1,900 and the total charges are 11,900

#### Scenario: Annual cadence and range

- GIVEN an annual insurance of 600,000 from period 1 to 24
- WHEN a 36-month schedule is generated
- THEN it appears in periods 1 and 13 only

#### Scenario: Bundled presentation

- GIVEN charges flagged as bundled
- WHEN the row is rendered
- THEN the installment total equals principal + interest + charges with no separate charge lines

### Requirement: Real cost summary

The schedule MUST report totals of interest, charges and taxes, and the cost per payment, separately from principal.

#### Scenario: Totals reconcile

- GIVEN any generated schedule
- THEN sum(installments) = principal + interest + charges + taxes, ±1 peso per row
