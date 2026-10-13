# Legal Rate Parameters Specification

## Purpose

Legal figures (IBC, usury cap, SMMLV) are household data that members maintain, with the code tables as fallback. All figures are informational: they warn and never block, and the bank's statement always wins.

## Requirements

### Requirement: Household legal rates storage

The system MUST store legal figures in a household-scoped `legal_rates` table with columns `householdId`, `kind` (`ibc` | `usury` | `smmlv`), `modality`, `validFrom`, `validTo`, `value`, `source` and `actorId`. The key (`householdId`, `kind`, `modality`, `validFrom`) MUST be unique. Any household member MAY create or update a row and `actorId` MUST be stored. Rows MUST NOT be deleted; a row is superseded by editing it. Monthly rows (`ibc`, `usury`) MUST span a calendar month; `smmlv` rows MUST span a calendar year and be in pesos. Known modalities: `consumer`, `low_amount`, `productive`, `productive_rural`, `productive_urban`, `popular_rural`, `popular_urban`, `mortgage`. The table MUST be added without altering existing tables (create-only migration, safe to re-run).

#### Scenario: Save twice for the same key

- GIVEN a `usury` row for `consumer` starting 2026-11-01
- WHEN a member saves the same key with a new value
- THEN the existing row is updated and no second row exists
- AND `actorId` is the member who saved last

#### Scenario: Out-of-range value

- GIVEN a member enters an IBC or usury value of 2.8 or 280
- WHEN the row is saved
- THEN it is rejected (accepted range is 5 to 100 % EA) and nothing is written

#### Scenario: Migration rerun

- GIVEN `legal_rates` already exists
- WHEN the migration runs again
- THEN it changes nothing and existing rows are intact

### Requirement: Usury derivation from IBC with override

For a modality that follows the 1.5 rule, usury MUST equal IBC × 1.5, computed in basis points and rounded half up. An explicit `usury` row for the same modality and month MUST win over the derived value. Modality `mortgage` is manual: usury MUST NOT be derived from an IBC row and MUST come only from an explicit `usury` row.

#### Scenario: Derivation

- GIVEN an IBC of 19.49 for `consumer` in a month
- THEN the derived usury is 29.24 % EA

#### Scenario: Rounding half up

- GIVEN an IBC of 19.06
- THEN the derived usury is 28.59 % EA (2859 bp exactly)

#### Scenario: Override wins

- GIVEN IBC 19.49 and an explicit `usury` row of 29.00 for the same month
- THEN the cap used is 29.00

#### Scenario: Mortgage is not derived

- GIVEN an IBC row for `mortgage` and no explicit `usury` row
- THEN no cap exists for `mortgage` in that month

### Requirement: SMMLV by year

The system MUST resolve the SMMLV for a year from the household rows first and from the code table otherwise. The 2026 default MUST be 1,750,905.

#### Scenario: Default

- GIVEN no `smmlv` row for 2026
- THEN SMMLV 2026 resolves to 1,750,905

#### Scenario: Household value wins

- GIVEN an `smmlv` row for 2026 with value 1,800,000
- THEN SMMLV 2026 resolves to 1,800,000

### Requirement: Resolution and precedence

`resolveLegal(rows, defaults)` MUST return `{usuryTable, smmlvTable}` in which household rows override the code defaults for the same modality and month (or year) and defaults fill the rest. Calculations MUST use, per table, the first present of: `opts.legal`, then `debt.legal`, then the code tables. Every debt loaded by the web and by Nia MUST carry the same resolved tables, so both surfaces compute identical figures.

#### Scenario: Household row beats code

- GIVEN a household `usury` row for `consumer` 2026-10 of 29.00 and a code default of 28.59
- THEN the cap for 2026-10-15 is 29.00

#### Scenario: Option beats decoration

- GIVEN `debt.legal` with cap 29.00 and `opts.legal` with cap 27.50
- THEN calculations use 27.50

#### Scenario: Code fallback

- GIVEN no `legal_rates` row, no `debt.legal` and no `opts.legal`
- THEN calculations use the code tables

### Requirement: Cap lookup with stale carry-forward

`capOn(table, modality, date)` MUST return the cap covering the date. When no row covers it, it MUST return the latest cap that starts on or before the date with `stale: true`. When no cap starts on or before the date, it MUST return no cap. It MUST NOT throw.

#### Scenario: Stale carry-forward

- GIVEN only the 2026-10 cap of 28.59 for `consumer`
- WHEN the cap for 2026-12-05 is requested
- THEN 28.59 is returned with `stale: true`

#### Scenario: Before any known cap

- GIVEN the earliest cap starts 2026-10-01
- WHEN the cap for 2026-01-15 is requested
- THEN no cap is returned and no error is thrown

### Requirement: Legal tables unavailable

When `legal_rates` cannot be read (for example the migration has not run), debts MUST still load and compute using the code tables, and the UI MUST show a notice `legal_rates_unavailable`.

#### Scenario: Missing table

- GIVEN the read of `legal_rates` fails
- WHEN debts load
- THEN every debt projects with the code tables and a notice is shown

### Requirement: Ajustes legal rates panel

Ajustes MUST be enabled in the sidebar and show a "Tasas legales" panel listing rows by modality and month with badges for stale (carried forward) and unverified (empty `source`). A form MUST accept a month, a modality, a toggle between IBC and explicit cap, and show the derived usury before saving. SMMLV MUST be editable by year. Invalid values MUST disable save with an inline message.

#### Scenario: Enter an IBC

- GIVEN the form on `consumer`, month 2026-11, IBC toggle
- WHEN the member types 19.49
- THEN the panel shows a derived usury of 29.24 before saving

#### Scenario: Stale warning

- GIVEN the current month has no row
- THEN the panel shows the carried cap with a stale badge and a prompt to update it

#### Scenario: Informational only

- GIVEN a debt whose rate exceeds the resolved cap
- THEN a warning is shown and creating or editing the debt is not blocked
