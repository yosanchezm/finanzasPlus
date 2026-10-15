# Delta for credit-card-debt

Base: `debt-management` and `debt-plan-changes`. No existing requirement text changes; both items are additive.

## ADDED Requirements

### Requirement: Revolving and excluded base per statement

Each projected statement MUST expose, additively, the revolving base (the balance on which interest accrued) and the excluded base (the balance that accrued no interest because the prior statement was paid in full by its due date). Both MUST be non-negative whole minor units. The statement interest MUST equal the card rate applied to the revolving base by the core's rule. Existing statement fields and values MUST NOT change.

#### Scenario: Revolving balance

- GIVEN 300,000 unpaid after the due date at a positive rate
- THEN the next statement shows a revolving base of 300,000 and interest on that base

#### Scenario: Paid in full

- GIVEN a statement of 800,000 paid in full by its due date
- THEN the next statement shows a revolving base of 0, an excluded base of 800,000 and interest 0

#### Scenario: Additive only

- GIVEN a fixture projection before this change
- THEN every pre-existing field has the same value after it

### Requirement: Corrected card terms

When a `terms_correction` is in force, the card projection MUST use the corrected statement day, due day and minimum rule for every statement from the start of the current terms version, clamping days beyond month end. Minimum payments, past-due flags, mora and payment allocation MUST be recomputed under the corrected terms.

#### Scenario: Corrected statement day

- GIVEN a card saved with statement day 15 and corrected to 20
- THEN every statement of the version closes on the 20th, clamped at month end

#### Scenario: Corrected minimum rule

- GIVEN a minimum rule corrected from 5% to 3%
- THEN past statements show the minimum under 3% and past-due flags are re-evaluated

#### Scenario: Correction voided

- GIVEN a voided correction
- THEN the card projection equals the one before the correction
