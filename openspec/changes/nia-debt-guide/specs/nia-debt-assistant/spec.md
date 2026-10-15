# Delta for nia-debt-assistant

Base: `debt-management` and `debt-plan-changes` (latest text quoted below).

## ADDED Requirements

### Requirement: Explain action and topic selection

Nia MUST support an `explain` action whose extraction carries a `topic` from the closed catalogue of `debt-explanations` and an optional debt selector. An unknown or missing topic MUST show a topic menu with one button per topic and MUST NOT guess. The answer MUST be rendered from code-built facts and MUST NOT require confirmation.

#### Scenario: Stated topic

- GIVEN "¿qué es NAMV?" with a stated 25.2% NAMV
- THEN the reply explains 2.1% MV and about 28.32% EA with the source line and the disclaimer

#### Scenario: No topic

- GIVEN "explícame mi deuda"
- THEN a topic menu is shown and nothing is written

### Requirement: Glossary router

After classification, a router folding case and accents MUST move glossary questions that name a debt concept (interest, rate conventions, usury, mora, charges, GMF, statement, restructure, prepayment) from `conversation` or `analysis` into `debt`/`explain`. A message that reports or requests a payment or another write MUST keep its original action. Glossary questions with no debt concept MUST stay in `conversation`.

#### Scenario: Override

- GIVEN "qué es la mora" classified as `conversation`
- THEN it is handled as `explain` topic `mora`

#### Scenario: Payment kept

- GIVEN "pagué la mora"
- THEN it is handled as a payment and not as an explanation

#### Scenario: Non-debt glossary

- GIVEN "qué es una acción en bolsa"
- THEN it stays in `conversation`

### Requirement: Explain is read-only and session-safe

An explanation MUST NOT write any row or event and MUST NOT create, change or clear the pending action. A pending Confirm MUST survive any explanation. Explain MUST NOT add a Gemini call beyond classification and extraction.

#### Scenario: Pending survives

- GIVEN a pending payment awaiting Confirm
- WHEN the user asks "¿qué es la usura?"
- THEN the explanation is sent and the pending is unchanged and still confirmable

#### Scenario: No writes

- GIVEN any explanation
- THEN no debt, event, expense row or pending is created

### Requirement: Stateless explain buttons and marker

Explanations MAY offer buttons `nia:exp:<topic>:<debtId>`. Each callback MUST fit in 64 bytes, MUST be read-only and MUST NOT require a pending stage. An unknown topic, a deleted debt or a debt outside the user's scope MUST get a short safe reply without writes. The session MAY keep a `{topic, debtId}` marker of the last explanation; the marker MUST NOT touch the pending.

#### Scenario: Longest callback

- GIVEN topic `card_interest_drop` and a 36-character debt id
- THEN the callback data is at most 64 bytes

#### Scenario: Stale or foreign button

- GIVEN a button whose debt was deleted or belongs to another member's personal scope
- WHEN tapped
- THEN Nia answers that it is no longer available and writes nothing

#### Scenario: Follow-up

- GIVEN the marker `{mora, debtId}` and "¿y con ejemplo?"
- THEN the same topic is rendered for the same debt

### Requirement: Card creation and charge presets in extraction

`create` MUST accept kind card with statement day, due day, minimum-payment rule, rate with convention and management fee. Extraction MUST accept the `pctOfCharge` basis with a reference to a charge label; a reference to a missing charge MUST be rejected by code with a correction request and nothing written. Missing statement day, due day or minimum rule MUST be asked, never defaulted.

#### Scenario: Card create

- GIVEN a complete card description
- THEN a preview with the EA echo and charges is shown and Confirm writes one debt

#### Scenario: Dangling reference

- GIVEN an IVA charge referencing a fee that is not in the set
- THEN Nia asks for a correction and writes nothing

### Requirement: Terms correction action

Nia MUST support a `terms_correction` action for card statement day, due day, minimum rule (rule, percentage, floor), rate with its convention as the bank states it, and modality. The preview MUST come from the core: before and after values, the EA echo, the impacted past cost rows, and a note that the correction applies from the start of the debt. Nia MUST write only after Confirm, once. A value that does not change the stored terms MUST be refused with nothing written.

#### Scenario: Statement day

- GIVEN "el corte de la tarjeta es el 20, no el 15"
- THEN the preview shows 15 to 20 and the retroactive note, and Confirm writes one `terms_correction`

#### Scenario: Unchanged value

- GIVEN a stated day equal to the stored day
- THEN Nia says nothing changes and writes nothing

## MODIFIED Requirements

### Requirement: Debt intent, extraction only

Nia MUST support a `debt` intent with actions create, pay, simulate, advise, list, `legal_rate`, `rate_change`, `charge_change`, `restructure`, mora, `explain`, `setup` (a described case handed to the advisor of `nia-debt-advisor`) and `terms_correction`. The LLM MUST only extract fields; all validation and arithmetic MUST be done by shared core code. Every write MUST require confirmation; `explain` is read-only and MUST NOT require one. Replies for the new actions MUST be built from structured `facts` and follow the paraphrase guardrail. `create` MUST support cards as well as loans.
(Previously: no `explain`, `setup` or `terms_correction`; `create` was loans only and cards were created on the web.)

#### Scenario: Pay request

- GIVEN "I paid 500 thousand on the car loan"
- WHEN processed
- THEN extracted fields are validated and a preview with the allocation split and new balance is shown
- AND no event exists until the user confirms

#### Scenario: Invalid extraction

- GIVEN an extracted negative amount
- THEN Nia asks for a correction and writes nothing

#### Scenario: New action needs confirmation

- GIVEN any of `rate_change`, `charge_change`, `restructure`, `legal_rate`, mora or `terms_correction`
- THEN a preview is shown and no row or event exists until the user confirms

#### Scenario: Explain needs no confirmation

- GIVEN an `explain` request
- THEN the answer is sent directly and nothing is written

### Requirement: Rate and charge change actions

Nia MUST support `rate_change` and `charge_change`. `rate_change` MUST collect an effective date (default today), the rate with its convention (asking with inline buttons when missing) and, for loans, the mode `keep_term` or `keep_installment` (asking with a button when missing; `keep_installment` only for French amortization). The preview MUST show the EA echo, usury notice and before/after from the core. On `installment_too_low` Nia MUST explain it and offer `keep_term`. `charge_change` MUST add, edit or remove a charge. Adding MUST use a preset (management fee with IVA, life insurance, other insurance, GMF 4x1000) or explicit fields, and an added charge MUST be valid in the resulting set. Edit and remove MUST match by label or kind ignoring case and accents. When the effective date precedes a recorded payment whose cost would change, Nia MUST add a note that costs update when the debt is opened on the web. Both actions MUST apply to cards, and neither MUST alter data before confirmation.
(Previously: `charge_change` could only edit or remove a charge, and adding was refused with a pointer to the web.)

#### Scenario: Rate change with mode

- GIVEN "bajó la tasa del crédito del banco a 22% EA desde hoy"
- THEN Nia asks `keep_term` or `keep_installment`
- AND after the choice shows the preview and waits for confirmation

#### Scenario: Remove a charge

- GIVEN "quita el seguro de vida del crédito"
- THEN the preview shows the charge removed from the effective date and the new installment

#### Scenario: Add a charge

- GIVEN "agrega un seguro de vida de 12 mil mensual a la tarjeta"
- THEN the preview shows the charge added from the effective date
- AND Confirm writes one `charge_change`

#### Scenario: Add fee with IVA

- GIVEN a fee of 45,000 added with its IVA preset
- THEN the preview shows IVA 8,550 linked to the fee

#### Scenario: Backdated note

- GIVEN a change effective before a recorded payment
- THEN the preview includes the cost-update note

### Requirement: Conversation callbacks for all actions

The `nia:conv` callback MUST apply to every action that needs a rate convention, not only create. A `nia:mode:keep_term` and `nia:mode:keep_installment` callback MUST set the mode of a pending `rate_change`. A callback that does not match the current pending (stale button) MUST be ignored with a short message and MUST NOT write. `nia:exp` callbacks are the only exception: they are stateless and read-only and need no pending.
(Previously: every callback required a matching pending stage.)

#### Scenario: Convention on rate change

- GIVEN a `rate_change` with an ambiguous rate
- WHEN the user taps a convention button
- THEN the pending is updated and the preview is shown

#### Scenario: Stale button

- GIVEN a mode button from an earlier, already confirmed pending
- WHEN it is tapped
- THEN Nia replies that it is no longer valid and writes nothing

#### Scenario: Explain button without pending

- GIVEN no pending and a `nia:exp` button
- WHEN it is tapped
- THEN the explanation is shown and nothing is written

### Requirement: Paraphrase guardrail

Gemini MAY paraphrase only the structured `facts`. If the reply contains any number absent from `facts`, any spelled-out Spanish number (for example "veintiocho", "cuatro por mil", "un millón"), or exceeds the length cap, Nia MUST send a deterministic template instead. The cap MUST NOT exceed 1,200 characters per message. Debt summaries computed by code MUST be fed to the `analysis` intent, and the model MUST NOT do debt arithmetic. The hardened guard MUST ship before any paraphrase of explanation topics.
(Previously: only digit tokens were checked, with no spelled-out numbers and no length cap.)

#### Scenario: Invented number

- GIVEN a paraphrase containing 42% not in `facts`
- THEN the deterministic template is sent

#### Scenario: Changed digit

- GIVEN a paraphrase that alters 28.32 to 28.23
- THEN the deterministic template is sent

#### Scenario: Spelled-out number

- GIVEN a paraphrase saying "cuatro por mil"
- THEN the deterministic template is sent

#### Scenario: Over-long paraphrase

- GIVEN a paraphrase above the cap
- THEN the deterministic template is sent

#### Scenario: Faithful paraphrase

- GIVEN a reply whose numbers all appear in `facts`, with no spelled-out numbers and within the cap
- THEN the paraphrase is sent

#### Scenario: Gemini failure

- GIVEN the paraphrase call fails or times out
- THEN the template is sent and the flow completes
