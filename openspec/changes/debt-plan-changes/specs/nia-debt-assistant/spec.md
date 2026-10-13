# Delta for nia-debt-assistant

## ADDED Requirements

### Requirement: Legal rate action

Nia MUST support a `legal_rate` action that records a usury or IBC value for a modality and month, for example "la usura de noviembre es 28.2". The LLM MUST extract only the phrase and the value; the month MUST be resolved in code. Nia MUST show a preview echoing kind, modality, month and value, and write only after confirmation. A value outside 5-100 MUST be refused with a request for correction and nothing written. When a row for the same key exists, Confirm MUST update it instead of failing. Repeated confirmations MUST leave one row.

#### Scenario: New value

- GIVEN "la usura de noviembre es 28.2" and no row for that month
- THEN the preview shows usury 28.20 % EA for `consumer`, month 2026-11
- AND Confirm writes the row once

#### Scenario: Existing row

- GIVEN a row already exists for that key
- WHEN Confirm is delivered
- THEN the row is updated and Nia reports it as an update

#### Scenario: Out of range

- GIVEN a value of 2.82
- THEN Nia asks for a correction and writes nothing

### Requirement: Rate and charge change actions

Nia MUST support `rate_change` and `charge_change`. `rate_change` MUST collect an effective date (default today), the rate with its convention (asking with inline buttons when missing) and, for loans, the mode `keep_term` or `keep_installment` (asking with a button when missing; `keep_installment` only for French amortization). The preview MUST show the EA echo, usury notice and before/after from the core. On `installment_too_low` Nia MUST explain it and offer `keep_term`. `charge_change` MUST only edit or remove an existing charge, matched by label or kind ignoring case and accents; adding a charge MUST be refused with a pointer to the web. When the effective date precedes a recorded payment whose cost would change, Nia MUST add a note that costs update when the debt is opened on the web. Both actions MUST apply to cards, and neither MUST alter data before confirmation.

#### Scenario: Rate change with mode

- GIVEN "bajó la tasa del crédito del banco a 22% EA desde hoy"
- THEN Nia asks `keep_term` or `keep_installment`
- AND after the choice shows the preview and waits for confirmation

#### Scenario: Remove a charge

- GIVEN "quita el seguro de vida del crédito"
- THEN the preview shows the charge removed from the effective date and the new installment

#### Scenario: Add a charge

- GIVEN a request to add a new insurance
- THEN Nia refuses and points to the web, writing nothing

#### Scenario: Backdated note

- GIVEN a change effective before a recorded payment
- THEN the preview includes the cost-update note

### Requirement: Restructure action

Nia MUST support `restructure` for loans (not cards) with overrides for rate, system, periodicity, number of periods, first due date, charges changes and `waiveLate`. The pending MUST store only the overrides, and the full terms MUST be rebuilt from the live debt at Confirm time. If the rebuilt terms are invalid, produce an unreadable event or exceed the payload limit, Nia MUST write nothing and explain. The preview MUST show the arrears breakdown, the carried balance and the new installment.

#### Scenario: Preview and confirm

- GIVEN "reestructura el crédito a 48 cuotas con primera cuota el 2026-12-05"
- THEN the preview shows the carried balance, the new installment and the usury notice
- AND Confirm writes one `restructure`

#### Scenario: Debt changed before Confirm

- GIVEN a payment recorded between preview and Confirm
- WHEN Confirm is delivered
- THEN the terms are rebuilt from the updated debt and the written carried balance reflects the payment

#### Scenario: Card

- GIVEN a restructure request for a card
- THEN Nia refuses and writes nothing

### Requirement: Mora action

Nia MUST support a mora action that sets the late-interest policy of a debt through a dated `late_policy` event (mode, optional rate or multiple, grace days, effective date defaulting to today). The preview MUST show the mode, the effective date, the cap in force and a note that mora is not retroactive. A rate above the cap MUST show the capped effective rate.

#### Scenario: Enable mora

- GIVEN "activa mora a la usura en el crédito del banco"
- THEN the preview shows mode `usury`, today as effective date and the cap in force
- AND Confirm writes one `late_policy` event

#### Scenario: Fixed rate above the cap

- GIVEN a fixed mora of 40% EA and a cap of 28.59
- THEN the preview states that 28.59 will apply

### Requirement: Conversation callbacks for all actions

The `nia:conv` callback MUST apply to every action that needs a rate convention, not only create. A `nia:mode:keep_term` and `nia:mode:keep_installment` callback MUST set the mode of a pending `rate_change`. A callback that does not match the current pending (stale button) MUST be ignored with a short message and MUST NOT write.

#### Scenario: Convention on rate change

- GIVEN a `rate_change` with an ambiguous rate
- WHEN the user taps a convention button
- THEN the pending is updated and the preview is shown

#### Scenario: Stale button

- GIVEN a mode button from an earlier, already confirmed pending
- WHEN it is tapped
- THEN Nia replies that it is no longer valid and writes nothing

## MODIFIED Requirements

### Requirement: Debt intent, extraction only

Nia MUST support a `debt` intent with actions create, pay, simulate, advise, list, `legal_rate`, `rate_change`, `charge_change`, `restructure` and mora. The LLM MUST only extract fields; all validation and arithmetic MUST be done by shared core code. Every write MUST require confirmation. Replies for the new actions MUST be built from structured `facts` and follow the paraphrase guardrail.
(Previously: only create, pay, simulate, advise and list.)

#### Scenario: Pay request

- GIVEN "I paid 500 thousand on the car loan"
- WHEN processed
- THEN extracted fields are validated and a preview with the allocation split and new balance is shown
- AND no event exists until the user confirms

#### Scenario: Invalid extraction

- GIVEN an extracted negative amount
- THEN Nia asks for a correction and writes nothing

#### Scenario: New action needs confirmation

- GIVEN any of `rate_change`, `charge_change`, `restructure`, `legal_rate` or mora
- THEN a preview is shown and no row or event exists until the user confirms

### Requirement: Rate convention echo

On create, `rate_change` and `restructure`, Nia MUST show the parsed convention and the EA equivalent, and MUST ask with inline buttons when the convention is missing. Usury notices, resolved from the household legal table, MUST appear and MUST NOT block.
(Previously: only on create; the cap came from the code table.)

#### Scenario: Ambiguous rate

- GIVEN "loan at 2% monthly" with no stated timing
- THEN Nia asks to choose the convention before showing a preview

#### Scenario: Echo

- GIVEN 2.1% MV
- THEN the preview shows about 28.3% EA

#### Scenario: Household cap in the notice

- GIVEN a household cap of 29.00 and a 30% EA rate on a `rate_change`
- THEN the notice cites 29.00 and the preview is still shown

### Requirement: Exactly-once confirmation

The pending payload MUST be compact (about 1.5 KB or less) and carry a `dedupeKey = debt:{pendingId}` for every action that writes a debt event, including `rate_change`, `charge_change`, `restructure` and mora. Repeated confirmations MUST create one event and at most one cost row, including after a Telegram retry. After a plan change is written, a done marker MUST make a repeated Confirm reply that it is already recorded.
(Previously: described only for payments.)

#### Scenario: Double tap

- GIVEN a pending payment
- WHEN Confirm is delivered twice
- THEN one event and at most one expense exist, and the second tap replies "already recorded"

#### Scenario: Strategy needed

- GIVEN an amount above the installment
- THEN Nia asks reduce term, reduce installment or advance before confirming

#### Scenario: Plan change retry

- GIVEN a pending `rate_change` whose Confirm is delivered twice after a Telegram retry
- THEN exactly one `rate_change` event exists and the second reply says it was already recorded
