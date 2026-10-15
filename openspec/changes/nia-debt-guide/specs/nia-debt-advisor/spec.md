# Nia Debt Advisor Specification

## Purpose

Nia turns a described debt case into a proposed setup (create) or a set of adjustments, using presets. The advisor never writes by itself: every write goes through the existing pending, Confirm and exactly-once flow. Numbers come from the core; the model only extracts fields.

## Requirements

### Requirement: Proposal is read-only and complete

`proposeSetup(case)` MUST return a draft, `assumptions[]`, `questions[]` and a core preview. It MUST NOT write anything. The reply MUST show the assumptions, the open questions and the preview, and MUST carry the educational disclaimer. A draft MUST NOT be confirmable while a blocking question is open.

#### Scenario: Proposal without writes

- GIVEN a described case
- WHEN `proposeSetup` runs
- THEN a draft, assumptions, questions and a preview are shown and no row or event exists

#### Scenario: Open question

- GIVEN a blocking question is unanswered
- THEN no Confirm option is offered

### Requirement: Charge presets

The advisor MUST offer these presets: management fee with IVA, life insurance, other insurance and GMF 4x1000. A preset MUST fix label, kind, basis and cadence, and MUST NOT invent an amount: a missing amount MUST become a question. The fee-with-IVA preset MUST create the IVA as a `pctOfCharge` charge of 19 linked to the fee. The IVA rate MUST appear in `assumptions[]`. A GMF preset MUST use 0.4%.

#### Scenario: Fee plus IVA

- GIVEN a fee of 45,000 with the fee-with-IVA preset
- THEN the draft has the fee and an IVA charge `pctOfCharge` 19 linked to it
- AND the preview shows IVA 8,550

#### Scenario: Missing amount

- GIVEN a life-insurance preset with no amount
- THEN a question asks for the amount and the draft is not confirmable

#### Scenario: GMF

- GIVEN a base of 400,000
- THEN the GMF charge is 1,600

### Requirement: Rate convention echo and mora default

The proposal MUST echo the stated rate with its convention and the EA equivalent, and MUST ask with buttons when the convention is missing instead of assuming. The usury notice MUST appear and MUST NOT block. The mora policy MUST default by debt kind as in `late-interest` (usury for consumer loans and cards, none for family) and MUST be listed in `assumptions[]`.

#### Scenario: Echo

- GIVEN 2.1% MV
- THEN the proposal shows about 28.32% EA

#### Scenario: Missing convention

- GIVEN "2% mensual" with no timing
- THEN a convention question is asked before any preview

#### Scenario: Mora default

- GIVEN a consumer card
- THEN the draft has mora `usury` and says so in the assumptions

### Requirement: Card proposal

A card proposal MUST ask for the statement day, the due day and the minimum-payment rule, and MUST NOT save provisional values. When the user does not know a statement or due day after being asked once, card creation MUST be blocked and the user MUST be told what is missing.

#### Scenario: Bancolombia card

- GIVEN a card at 2.1% MV with a fee of 45,000 plus IVA 19%
- THEN the proposal echoes about 28.32% EA, links IVA 8,550 to the fee and sets mora to usury
- AND it asks for statement day, due day and minimum rule

#### Scenario: Unknown statement day

- GIVEN the user does not know the statement day
- THEN creation is blocked and nothing is written

### Requirement: Exactly one write after Confirm

After Confirm, a proposed debt MUST be created exactly once with its terms and charges, following the existing creation contract. A card MUST write only its debt row, with no event. A loan MUST write its debt row plus its `disbursement` event, and no other event. A repeated Confirm MUST reply that it is already recorded and MUST write nothing more.

#### Scenario: Card creation

- GIVEN a complete card proposal
- WHEN Confirm is delivered twice
- THEN exactly one debt exists and the second reply says it was already recorded

### Requirement: Adjustment checklist and action choice

For an existing debt, the advisor MUST compare the user's description with the stored terms and list the differences as proposed steps. Data that was wrong from the start MUST use `terms_correction`; a real-world change MUST use `rate_change`, `charge_change` or mora. When it cannot tell which applies, it MUST ask.

#### Scenario: Wrong statement day

- GIVEN a stored statement day 15 and the user says it was always the 20th
- THEN the step is a `terms_correction`

#### Scenario: Real rate drop

- GIVEN the bank lowered the rate last month
- THEN the step is a `rate_change`

### Requirement: Sequential chain

A plan with several steps MUST run as a chain: one pending at a time, one Confirm per step, each step previewed against the live debt state. The order MUST put corrections first, then the order the user stated. A failed step or a cancel MUST stop the chain and report completed and remaining steps. Each pending MUST stay within about 1.5 KB and carry its own `dedupeKey`.

#### Scenario: Two steps

- GIVEN a correction followed by a charge addition
- WHEN the first is confirmed
- THEN the second is previewed on the corrected debt and waits for its own Confirm

#### Scenario: Cancel mid-chain

- GIVEN a chain of three steps with the first confirmed
- WHEN the user cancels the second
- THEN the third is not run and the report lists step one done and two remaining

### Requirement: Unsupported fields

For the card limit, advance rate, `prepaymentPenaltyPct`, `allocationOrder` and the mora base, the advisor MUST explain the field and reply «no soportado aún», MUST NOT write, and MUST NOT pretend the value was saved.

#### Scenario: Card limit

- GIVEN "mi cupo es 5 millones"
- THEN Nia replies «no soportado aún» and writes nothing

### Requirement: No extra model calls

The advisor MUST NOT add a Gemini call beyond classification and extraction. Statement photo or PDF reading MUST NOT be offered.

#### Scenario: Call budget

- GIVEN any advisor turn
- THEN at most two Gemini calls are made
