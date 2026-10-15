# Delta for debt-web-management

Base: `debt-management` and `debt-plan-changes` (latest text quoted below).

## ADDED Requirements

### Requirement: Correct data dialog

"Corregir datos" MUST let the user correct data that was wrong from the start, writing a `terms_correction` through the shared commit flow. Cards MUST show statement day, due day and minimum rule, percentage and floor; every debt MUST show the rate with its convention as the bank states it, and the modality. Fields MUST be prefilled with the current values. The dialog MUST state that the correction applies from the start of the debt and that a real-world change uses "Cambiar tasa". It MUST show the EA echo, a before/after preview, and the impacted past cost rows from `previewChange`. Save MUST be disabled for invalid values or no change, and saving twice MUST create one event. Unsupported fields MUST NOT appear.

#### Scenario: Card correction preview

- GIVEN a card with statement day 15
- WHEN the user enters 20
- THEN the preview shows 15 to 20 and lists impacted past costs, if any

#### Scenario: Loan fields

- GIVEN a loan
- THEN statement day, due day and minimum rule are not shown

#### Scenario: No change

- GIVEN values equal to the stored ones
- THEN save is disabled with an inline message

#### Scenario: Double submit

- GIVEN the user taps Save twice
- THEN one `terms_correction` exists

#### Scenario: Save error

- GIVEN the write fails
- THEN an error with retry is shown and the projection is unchanged

### Requirement: Correction history, void and reconcile

The event history MUST show a one-line summary of a `terms_correction` listing changed fields with old and new values, not an amount of 0. A correction MUST be voidable with confirmation. After a save or void, cost rows MUST be reconciled and a toast MUST report the number of rows changed.

#### Scenario: Summary

- GIVEN a correction of statement day 15 to 20
- THEN the history shows both values

#### Scenario: Void with reconcile

- GIVEN a correction that changed two cost rows
- WHEN the user voids it
- THEN reconcile runs and a toast reports 2 rows updated

### Requirement: Explain popovers

The debt views SHOULD offer «¿Qué es esto?» popovers next to rate, mora, charges, minimum payment and statement figures. A popover MUST render the same topic text, source line and disclaimer as `debt-explanations`, MUST be read-only, and MUST be keyboard accessible. It MUST be hidden for a topic whose legal constant lacks `reviewedOn`.

#### Scenario: Open popover

- GIVEN a loan detail with mora
- WHEN the user opens «¿Qué es esto?» next to the mora figure
- THEN the `mora` explanation with its disclaimer is shown and nothing is written

#### Scenario: Unreviewed topic

- GIVEN a topic whose legal constant lacks `reviewedOn`
- THEN its popover is not shown

## MODIFIED Requirements

### Requirement: More-actions menu

The debt detail MUST show a "Más acciones" menu with "Cambiar tasa", "Cambiar seguros y cargos", "Configurar mora", "Corregir datos" and "Reestructurar". For card debts the menu MUST omit "Reestructurar". Each action opens a dialog that writes through the shared commit flow and its exactly-once guard.
(Previously: four actions, without "Corregir datos".)

#### Scenario: Loan menu

- GIVEN a loan detail
- THEN the menu lists the five actions

#### Scenario: Card menu

- GIVEN a card detail
- THEN the menu lists "Cambiar tasa", "Cambiar seguros y cargos", "Configurar mora" and "Corregir datos", and not "Reestructurar"
