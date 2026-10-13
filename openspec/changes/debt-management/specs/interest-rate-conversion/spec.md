# Delta for interest-rate-conversion

## ADDED Requirements

### Requirement: Rate is stored as stated

A rate MUST be stored as `{value, basis, periodicity, timing}` exactly as the lender states it. Supported bases: effective annual (EA), nominal with compounding (NAMV m=12, NATV m=4, other periodicities), anticipated, and interest-free. Conversion MUST be pure and deterministic.

| Input | Periodic rate i | EA |
|---|---|---|
| EA | `(1+EA)^(1/n) − 1` | EA |
| Nominal j, m periods | `j/m` | `(1+j/m)^m − 1` |
| Anticipated ia | `ia/(1−ia)` | `(1−ia)^−m − 1` |
| Interest-free | 0 | 0 |

#### Scenario: EA to monthly

- GIVEN 24% EA
- WHEN the monthly periodic rate is derived
- THEN i is within 1e-6 of `1.24^(1/12) − 1` (about 1.8088%)
- AND `(1+i)^12 − 1` returns 24% within 1e-9

#### Scenario: NAMV to EA

- GIVEN a nominal rate of 2.1% per month (25.2% NAMV)
- WHEN the EA equivalent is computed
- THEN the result is about 28.3% (`1.021^12 − 1`)

#### Scenario: Anticipated monthly

- GIVEN 2% monthly anticipated
- WHEN the periodic rate is derived
- THEN i equals `0.02/0.98` (about 2.0408%)

#### Scenario: Interest-free

- GIVEN a rate with basis interest-free
- WHEN converted to any periodicity
- THEN i = 0 and EA = 0

### Requirement: Round trip

For every supported basis, periodicity and timing, converting to EA and back to the original basis MUST return the original value within 1e-9. A non-finite, negative or `>= 1` anticipated value MUST be rejected with a typed validation error.

#### Scenario: Property round trip

- GIVEN random values in 0%–60% across all bases
- WHEN converted to EA and back
- THEN each result matches the input within 1e-9

#### Scenario: Invalid anticipated

- GIVEN an anticipated monthly rate of 100%
- WHEN conversion is requested
- THEN a validation error is returned and no number is produced

### Requirement: Periodicities and date clamping

The core MUST support weekly, biweekly, monthly, bimonthly, quarterly, semiannual and annual periodicities. Due dates MUST be `YYYY-MM-DD` strings; a due day beyond the month's last day MUST clamp to the last day.

#### Scenario: Month-end clamp

- GIVEN a monthly due day of 31 starting 2026-01-31
- WHEN due dates are generated
- THEN the next dates are 2026-02-28 then 2026-03-31

### Requirement: Usury notice is informational

Given a manually maintained cap table with an `asOf` date, the core SHOULD report whether a rate's EA exceeds the cap for its modality. It MUST include the `asOf` date and MUST NOT block creation.

#### Scenario: Above cap

- GIVEN a consumer-credit cap of 28.59% EA as of 2026-10
- WHEN a 30% EA debt is evaluated
- THEN a warning with the cap and `asOf` is returned
- AND the debt can still be created

#### Scenario: No cap data

- GIVEN no cap entry for the modality
- WHEN evaluated
- THEN no warning is returned and no error is thrown
