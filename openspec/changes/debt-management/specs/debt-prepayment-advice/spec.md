# Delta for debt-prepayment-advice

## ADDED Requirements

### Requirement: Strategy simulation

Given a debt state and an extra amount, the core MUST compute for each strategy (reduce term, reduce installment, advance installments): new term, new installment, total interest and charges remaining, and the savings versus no prepayment. Simulation MUST be read-only.

#### Scenario: Two-strategy comparison

- GIVEN French 10,000,000 at 24% EA, 36 months, after 12 payments, extra 2,000,000
- WHEN both strategies are simulated
- THEN reduce-term has fewer remaining installments with an unchanged installment
- AND reduce-installment keeps the term with a lower installment
- AND interest saved by reduce-term is greater than or equal to that of reduce-installment

#### Scenario: Advance installments

- GIVEN any debt
- WHEN advance-installments is simulated
- THEN interest saved is 0

#### Scenario: Extra exceeds balance

- GIVEN an extra larger than the outstanding balance
- WHEN simulated
- THEN the result reports full payoff capped at the balance, with no negative balance

### Requirement: Deterministic verdict

The default verdict MUST be "reduce term". The verdict MUST be "reduce installment" or "pay the higher-rate debt first" when the cash margin is below a configurable threshold or another active debt has a higher EA. At 0% the verdict MUST be liquidity-only and MUST NOT claim interest savings. All thresholds MUST be configurable. Prepayment penalty MUST default to 0 and be informational.

#### Scenario: Default

- GIVEN comfortable cash margin and no higher-rate debt
- WHEN advice is computed
- THEN the verdict is reduce term

#### Scenario: Tight margin

- GIVEN a 3-month income minus expense below the threshold
- WHEN advice is computed
- THEN the verdict is reduce installment and cites the margin

#### Scenario: Higher-rate debt exists

- GIVEN a card at 35% EA and a loan at 18% EA
- WHEN advice is computed for the loan
- THEN the verdict is to pay the higher-rate debt first

#### Scenario: 0% debt

- GIVEN a 0% family loan
- THEN both strategies show 0 interest saved and the verdict states the choice is liquidity-only

### Requirement: Structured facts

Advice MUST return a `facts` object containing every number it exposes (terms, installments, savings, ratios) plus a reason code per signal, so a reply can be validated against it.

#### Scenario: Facts completeness

- GIVEN any advice result
- THEN every numeric field in the rendered summary is present in `facts`

### Requirement: Legal notice

The advice MAY include a Ley 1555 notice (free prepayment, choice of strategy) with `asOf`, and MUST NOT refuse or alter a simulation because of it.

#### Scenario: Mortgage

- GIVEN a mortgage debt
- WHEN advice is computed
- THEN the notice states the scope is unverified and the simulation is still produced
