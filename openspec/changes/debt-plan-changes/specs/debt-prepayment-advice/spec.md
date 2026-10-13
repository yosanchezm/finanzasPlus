# Delta for debt-prepayment-advice

## MODIFIED Requirements

### Requirement: Legal notice

The advice MAY include a Ley 1555 notice (free prepayment, choice of strategy) with `asOf`, and MUST NOT refuse or alter a simulation because of it. The notice SHOULD state the assumed scope threshold of 880 SMMLV in pesos, computed from the SMMLV resolved for the `asOf` year (household table first, then code, carrying the latest forward with `stale: true`), and whether the debt's principal is within it. The scope remains unverified and the notice MUST say so.
(Previously: the notice only said the scope was unverified, with no threshold and no SMMLV source.)

#### Scenario: Mortgage

- GIVEN a mortgage debt
- WHEN advice is computed
- THEN the notice states the scope is unverified and the simulation is still produced

#### Scenario: Threshold from the code table

- GIVEN a mortgage with principal 300,000,000 as of 2026-10-13 and no household SMMLV row
- THEN the notice states a threshold of 1,540,796,400 (880 × 1,750,905)
- AND states that the principal is within it

#### Scenario: Above the threshold

- GIVEN a mortgage with principal 2,000,000,000
- THEN the notice states the principal exceeds the threshold and the scope may not apply
- AND the simulation is still produced

#### Scenario: Household SMMLV wins

- GIVEN a household SMMLV row for 2026 of 1,800,000
- THEN the threshold is 1,584,000,000
