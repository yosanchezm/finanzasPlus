# Delta for debt-amortization-schedule

## MODIFIED Requirements

### Requirement: Real cost summary

The schedule MUST report totals of interest, charges and taxes, and the cost per payment, separately from principal. Scheduled installments MUST NOT include late interest. Each plan row in a projection MUST expose `lateMinor` (mora accrued for the row through `asOf`), `lateDays` (days accrued after grace) and `lateBaseMinor` (unpaid overdue principal of the row); the three MUST be 0 when the row is not overdue or the mora mode is `none`.
(Previously: no late-interest fields; rows carried no mora data.)

#### Scenario: Totals reconcile

- GIVEN any generated schedule
- THEN sum(installments) = principal + interest + charges + taxes, ±1 peso per row

#### Scenario: Overdue row with mora

- GIVEN a row with principal 199,505 that is 10 days overdue at 28.59% EA
- THEN `lateBaseMinor` is 199,505, `lateDays` is 10 and `lateMinor` is 1,375
- AND the row's scheduled installment is unchanged

#### Scenario: Mora off

- GIVEN mora mode `none` and an overdue row
- THEN `lateMinor`, `lateDays` and `lateBaseMinor` are 0
