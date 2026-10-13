# Delta for credit-card-debt

## ADDED Requirements

### Requirement: Card as parent debt with tranches

A card debt MUST have statement day, due day, minimum-payment rule, management fee and a rate, and MUST hold tranches: revolving balance, deferred plans (N installments, each with its own rate fixed at purchase), and cash advances. Day values beyond month end MUST clamp.

#### Scenario: Card with deferred and revolving

- GIVEN a card with a revolving balance of 500,000 at 28% EA and a deferred purchase of 1,200,000 at 12 installments and 0%
- WHEN projected
- THEN the deferred tranche yields 12 installments of 100,000 and the revolving tranche accrues interest at its own rate
- AND the statement total is the sum of tranche installments, interest and management fee

#### Scenario: Tranche rate independence

- GIVEN two deferred purchases made under different rates
- WHEN the card rate later changes
- THEN neither tranche's rate changes

### Requirement: Interest rules

Purchases paid in full by the due date MUST accrue no interest. An unpaid statement balance MUST accrue interest at the card rate. Cash advances MUST accrue interest from their date.

#### Scenario: Paid in full

- GIVEN a statement of 800,000 in one installment paid in full by the due date
- THEN interest is 0

#### Scenario: Revolving

- GIVEN 300,000 unpaid after the due date at a positive rate
- THEN the next statement includes interest on 300,000

### Requirement: Minimum payment and fee

The minimum payment MUST be computed from the configured rule (interest + fees + a portion of principal) and shown on each statement. The management fee MUST be a monthly charge and, with its taxes, MUST be part of the cost expense.

#### Scenario: Pay minimum

- GIVEN a minimum payment of M for a statement
- WHEN M is paid
- THEN the remainder stays revolving and the debt is not marked past due

#### Scenario: Below minimum

- GIVEN a payment under M
- THEN the shortfall is flagged past due

### Requirement: Statement-driven balance

In v1 the balance MUST change only through statement events, `charge` and `adjustment` events. A `transactions` expense MUST NOT alter the card balance automatically. An `adjustment` MUST reconcile the projection to a statement value.

#### Scenario: Adjustment

- GIVEN a projected balance 1,000,000 and a statement balance 1,000,350
- WHEN an adjustment of +350 is recorded
- THEN the projection equals 1,000,350

#### Scenario: Purchase expense

- GIVEN a purchase recorded as a normal expense on the card
- THEN the card balance is unchanged until a charge event is recorded
