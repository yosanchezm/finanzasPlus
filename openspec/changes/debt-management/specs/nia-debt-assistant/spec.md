# Delta for nia-debt-assistant

## ADDED Requirements

### Requirement: Debt intent, extraction only

Nia MUST support a `debt` intent with actions create, pay, simulate, advise and list. The LLM MUST only extract fields; all validation and arithmetic MUST be done by shared core code. Every write MUST require confirmation.

#### Scenario: Pay request

- GIVEN "I paid 500 thousand on the car loan"
- WHEN processed
- THEN extracted fields are validated and a preview with the allocation split and new balance is shown
- AND no event exists until the user confirms

#### Scenario: Invalid extraction

- GIVEN an extracted negative amount
- THEN Nia asks for a correction and writes nothing

### Requirement: Rate convention echo

On create, Nia MUST show the parsed convention and the EA equivalent, and MUST ask with inline buttons when the convention is missing. Usury notices MUST appear and MUST NOT block.

#### Scenario: Ambiguous rate

- GIVEN "loan at 2% monthly" with no stated timing
- THEN Nia asks to choose the convention before showing a preview

#### Scenario: Echo

- GIVEN 2.1% MV
- THEN the preview shows about 28.3% EA

### Requirement: Debt selector

`findDebt` MUST match name, lender and kind ignoring case and accents. Multiple matches MUST show a `nia:pick:{id}` keyboard. With no match and exactly one active debt, that debt MUST be used; with no match and several, Nia MUST ask.

#### Scenario: Accent folding

- GIVEN a debt "Crédito Vehículo"
- WHEN the user writes "vehiculo"
- THEN it matches

#### Scenario: Ambiguous

- GIVEN two debts matching "banco"
- THEN a pick keyboard lists both and nothing is written

### Requirement: Exactly-once confirmation

The pending payload MUST be compact (about 1.5 KB or less) and carry a `dedupeKey = debt:{pendingId}`. Repeated confirmations MUST create one event and at most one cost row, including after a Telegram retry.

#### Scenario: Double tap

- GIVEN a pending payment
- WHEN Confirm is delivered twice
- THEN one event and at most one expense exist, and the second tap replies "already recorded"

#### Scenario: Strategy needed

- GIVEN an amount above the installment
- THEN Nia asks reduce term, reduce installment or advance before confirming

### Requirement: Simulate and advise

Simulate MUST be read-only and show at most 12 plan rows within Telegram's 4096-character limit, plus a button to turn it into a payment. Advice MUST use the core's deterministic result.

#### Scenario: Long plan

- GIVEN a 360-row schedule
- THEN the reply shows the next 3-12 rows and a link to the web view

### Requirement: Paraphrase guardrail

Gemini MAY paraphrase only the structured `facts`. If the reply contains any number absent from `facts`, Nia MUST send a deterministic template instead. Debt summaries computed by code MUST be fed to the `analysis` intent, and the model MUST NOT do debt arithmetic.

#### Scenario: Invented number

- GIVEN a paraphrase containing 42% not in `facts`
- THEN the deterministic template is sent

#### Scenario: Faithful paraphrase

- GIVEN a reply whose numbers all appear in `facts`
- THEN the paraphrase is sent

#### Scenario: Gemini failure

- GIVEN the paraphrase call fails
- THEN the template is sent and the flow completes
