# Debt Explanations Specification

## Purpose

Channel-agnostic catalogue of debt explanations. Each answer is a deterministic Spanish template rendered over facts built by code from the user's real debt. No model produces a figure. Telegram (Nia) is the first consumer; the web popovers reuse the same topics.

## Requirements

### Requirement: Closed topic catalogue

The system MUST expose exactly these topics: `rate_conventions`, `usury_ibc`, `mora`, `payment_allocation`, `charges`, `card_statement`, `card_interest_drop`, `restructure_whatif`, `prepayment`. A request for any other topic MUST be rejected with the list of valid topics and MUST NOT render text. A topic that does not apply to the debt kind (for example `card_statement` on a loan) MUST answer that it does not apply and MUST NOT show figures.

#### Scenario: Unknown topic

- GIVEN a request for topic `tax_returns`
- THEN no explanation is rendered and the valid topics are returned

#### Scenario: Topic not applicable

- GIVEN a loan and topic `card_statement`
- THEN the answer states it applies to cards only and contains no figures

### Requirement: Facts from code, numbers only from facts

Every explanation MUST be built in two steps: a pure builder produces `facts` from public core results, then a template renders them. Builders MUST be read-only. Every digit token in rendered text MUST come from `facts` or from a fixed template constant. Without a resolvable debt and without user-stated figures, an explanation MUST be generic, MUST show no debt figures, and MUST invite the user to name a debt.

#### Scenario: Property of rendered numbers

- GIVEN any topic rendered over any fixture debt
- THEN every number in the text is present in `facts` or in the template constants

#### Scenario: No debt

- GIVEN a user with no debts asking about `mora`
- THEN a generic explanation is returned with no debt figures

### Requirement: Mandatory source line and disclaimer

Every explanation MUST end with a source line naming the data used (the debt, the core function family, or the legal constant) and the exact disclaimer «Información educativa con tus datos; no es asesoría financiera.» Estimated or rounded figures MUST be labelled «aproximado».

#### Scenario: Footer present

- GIVEN any rendered topic
- THEN the text contains a source line and the exact disclaimer sentence

#### Scenario: Estimate labelled

- GIVEN a card mora or a what-if projection
- THEN the figure is marked «aproximado»

### Requirement: Reviewed legal constants and release gate

Legal and educational copy (GMF, usura/IBC, Ley 1555, Ley 546, mora) MUST live in constants that each carry `sources` (non-empty) and `reviewedOn` (a date). An automated check MUST fail when any such constant lacks either. A topic whose constant lacks `reviewedOn` MUST NOT be answered; it MUST reply that the topic is under review. The owner copy review (legal constants plus one sample per topic) MUST be completed before the first deploy of explanation topics.

#### Scenario: Missing review date

- GIVEN a legal constant without `reviewedOn`
- THEN the automated check fails and the topic replies "under review"

#### Scenario: Reviewed constant

- GIVEN a constant with sources and `reviewedOn`
- THEN the topic renders and cites the source

### Requirement: Rate conventions topic

`rate_conventions` MUST show the stated or in-force rate with its convention, the effective annual (EA) equivalent and the periodic rate. For a debt it MUST use the rate in force.

#### Scenario: Nominal annual monthly-due

- GIVEN a stated 25.2% NAMV
- THEN the text explains it equals 2.1% per month and about 28.32% EA

#### Scenario: Monthly rate

- GIVEN a stated 2.1% MV
- THEN the text shows about 28.32% EA

### Requirement: Usury and IBC topic

`usury_ibc` MUST show the cap in force with its month and origin, and a modality caveat. When the legal table does not cover today, the facts MUST carry a stale warning that is shown and never blocks. When no cap is known it MUST say so. Mortgage Ley 546 MUST be explained only, with no computation.

#### Scenario: Stale cap

- GIVEN a carried-forward cap
- THEN the text shows the cap and the stale warning

#### Scenario: Mortgage

- GIVEN a mortgage debt
- THEN Ley 546 is explained and the text states that no computation is made

### Requirement: Mora topic

`mora` MUST explain base, days, cap and the unpaid-minimum rule for cards. Loan mora MUST equal the core value. Card mora MUST be labelled «aproximado».

#### Scenario: Loan mora

- GIVEN principal 199,505 overdue 10 days with a cap of 28.59% EA
- THEN the text shows mora 1,375

#### Scenario: Card mora

- GIVEN a card with an unmet minimum
- THEN the mora figure is labelled «aproximado»

### Requirement: Payment allocation topic

`payment_allocation` MUST show the order (charges and taxes, late interest, interest, principal) and the split of a real or stated payment from the core.

#### Scenario: Short payment

- GIVEN an installment with charges 10,000, interest 180,876 and principal 199,505 and a payment of 100,000
- THEN the text shows charges 10,000, interest 90,000 and principal 0

#### Scenario: Payment with mora

- GIVEN the same installment 10 days overdue at 28.59% EA
- THEN the text shows charges 10,000, mora 1,375, interest 88,625 and principal 0

### Requirement: Charges topic

`charges` MUST list the debt's charge lines by kind with the yearly sum and MUST explain that a tax charge refers to the charge it taxes. It MUST explain GMF with its rate and example from the reviewed constant.

#### Scenario: Fee and IVA

- GIVEN a fee of 45,000 with IVA 19% of that fee
- THEN the text shows IVA 8,550

#### Scenario: GMF

- GIVEN a base of 400,000 and GMF 0.4%
- THEN the text shows 1,600

### Requirement: Card topics

`card_statement` MUST show the last statement, its minimum payment and the minimum rule. `card_interest_drop` MUST show the revolving base and the excluded base of a statement from the core. It MUST include a what-if of paying only the minimum, labelled «aproximado». Paid in full by the due date MUST be explained as zero revolving base.

#### Scenario: Revolving

- GIVEN 300,000 unpaid after the due date
- THEN the text shows a revolving base of 300,000 and the interest on it

#### Scenario: Paid in full

- GIVEN a statement paid in full by its due date
- THEN the text shows no interest and a revolving base of 0

### Requirement: Restructure and prepayment topics

`restructure_whatif` MUST show the carried balance from the core, with and without waiving mora. `prepayment` MUST compare strategies from the core and show the Ley 1555 notice with its unverified-scope caveat.

#### Scenario: Restructure what-if

- GIVEN an installment of 390,381 unpaid 10 days at 28.59% EA
- THEN the text shows a carried balance of 391,756, or 390,381 waiving mora

#### Scenario: Prepayment

- GIVEN 1,200,000 at 0%, 12 installments, 1 paid, and an extra of 300,000
- THEN the text shows reduce term leaves 8 installments and reduce installment leaves 11

### Requirement: Length and splitting

A message MUST NOT exceed about 1,200 characters. Longer content MUST be split on paragraph boundaries into several messages, never cut, with the footer on the last part. Detail beyond the first message MUST be offered behind follow-up options.

#### Scenario: Long topic

- GIVEN content of 2,500 characters
- THEN it is returned in several parts each within the limit and no number is cut

### Requirement: Optional paraphrase

The template MUST be the canonical answer. A paraphrase MAY be offered only after the guard of `nia-debt-assistant` rejects spelled-out numbers and over-long text, and MUST fall back to the template on any rejection or failure.

#### Scenario: Paraphrase rejected

- GIVEN a paraphrase that spells a number out
- THEN the template is sent
