# Delta for interest-rate-conversion

## MODIFIED Requirements

### Requirement: Usury notice is informational

Given a cap table, the core SHOULD report whether a rate's EA exceeds the cap for its modality. The cap MUST be resolved from the injected legal table (`opts.legal`, then `debt.legal`, then the code table) using the cap lookup of `legal-rate-parameters`. A cap carried forward MUST be reported with `stale: true`. The notice MUST include the `asOf` date and MUST NOT block creation.
(Previously: the notice read a manually maintained cap table with no injected source, no stale carry-forward.)

#### Scenario: Above cap

- GIVEN a consumer-credit cap of 28.59% EA as of 2026-10
- WHEN a 30% EA debt is evaluated
- THEN a warning with the cap and `asOf` is returned
- AND the debt can still be created

#### Scenario: No cap data

- GIVEN no cap entry for the modality
- WHEN evaluated
- THEN no warning is returned and no error is thrown

#### Scenario: Injected table wins

- GIVEN a household cap of 29.00 for the month and a code cap of 28.59
- WHEN a 29.50% EA debt is evaluated
- THEN the warning cites the cap 29.00

#### Scenario: Stale cap

- GIVEN only the 2026-10 cap and an evaluation date in 2026-12
- WHEN a 30% EA debt is evaluated
- THEN the warning carries the 2026-10 cap with `stale: true`
