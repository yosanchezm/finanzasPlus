# Delta for credit-card-debt

## ADDED Requirements

### Requirement: Card mora on the unmet minimum

When mora is on for a card, it MUST accrue on the principal part of the minimum payment that was not paid by the statement's due date, from the day after the due date until the shortfall is paid or the next statement closes, whichever comes first. Interest, fees and taxes of the minimum MUST NOT accrue mora, and the cap, daily rate and day count MUST be those of the `late-interest` capability. Over those days mora MUST replace the revolving interest on that unmet principal. The accrued mora MUST appear as a late-interest line in the next statement and MUST NOT accrue further mora or interest itself. A statement `adjustment` MUST override the computed value. Card mora is approximate and informational.

#### Scenario: Unmet principal part

- GIVEN a minimum whose principal part is 125,000, unpaid, and a cap of 28.59% EA
- WHEN 10 days pass after the due date
- THEN the mora is 861
- AND it is billed in the next statement

#### Scenario: Minimum paid in full

- GIVEN the full minimum is paid by the due date
- THEN no mora accrues and the debt is not marked past due

#### Scenario: Mora off

- GIVEN a card whose mora mode is `none`
- WHEN the minimum is not met
- THEN no mora accrues and the shortfall is still flagged past due

#### Scenario: Statement adjustment

- GIVEN a computed mora of 861 and a statement showing 900
- WHEN an `adjustment` of +39 is recorded
- THEN the projection shows 900

### Requirement: Plan changes on cards

A card MUST support `rate_change` and `charge_change` from their effective date and MUST NOT support `restructure`. A card `rate_change` MUST apply to the card rate (the revolving balance) and MUST NOT alter the rate of any deferred tranche already fixed. The `keep_term` / `keep_installment` choice does not apply to cards.

#### Scenario: Rate change leaves tranches

- GIVEN a card with a deferred tranche fixed at 0% and a revolving balance at 28% EA
- WHEN a `rate_change` to 30% EA takes effect
- THEN the revolving balance accrues at 30% and the deferred tranche is unchanged

#### Scenario: Restructure rejected

- GIVEN a card
- WHEN a `restructure` draft is validated
- THEN a typed validation error is returned and nothing is written
