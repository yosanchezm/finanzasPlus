# Exploration: nia-debt-guide

The owner wants Nia to:
- explain any debt concept (interest, mora, usury, charges, card statements, restructures) using the user's real numbers;
- recommend and configure the right setup for the user's case.

Every number must come from code, never from Gemini.

## Current state (verified in code)

**Routing**
- `functions/nia/index.js` makes Gemini call #1, which classifies the message as `transaction|budget|goal|category|analysis|conversation|debt`.
- On `debt`, `handleDebt` makes call #2 (the specialized extraction).
- Current `ACTIONS`: `create|pay|simulate|advise|list|legal_rate|rate_change|charge_change|restructure|late_policy`. There is no `explain`.
- A paraphrase (call #3, 8 s timeout) exists only for `advise`.

**Callbacks**
- `nia:pick|strat|conv|mode|chg|simpay` are routed at index.js:1160.
- Each one requires a matching pending stage, so stale buttons are rejected.

**Pending and history limits**
- The pending payload is at most 1500 bytes.
- `callback_data` is at most 64 bytes.
- History keeps the last 10 turns of up to 700 characters each, capped at 7600 characters.

**Behaviour to rely on**
- `inform()` answers without touching the session, so an explanation does not clobber a pending Confirm.
- Exactly-once writes go through `confirmDebt` → `COMMIT[action]`, using `de{id}`, `debt:{id}` and a `done` marker.

**Unguarded paths**
- The `conversation` intent (financial-education answers) is free Gemini text.
- The `analysis` intent is also free Gemini text.
- Glossary questions currently land in one of these two.

**Guard**
- `debt/guard.js` `guardParaphrase(reply, facts, extra)` accepts a reply only if every digit token comes from `facts`.
- Spelled-out numbers ("cuatro por mil") and claims without digits pass the guard.

**Finance-core material already exported**

| Area | Functions and fields |
|---|---|
| Rates | `rateLabel`, `convertRate`, `toEffectiveAnnual`, `periodicRate`, `CONVENTIONS`, `rateInForce` |
| Legal | `resolveLegal`, `capOn` (stale, verified, origin, ibcEA), `usuryNotice`, `ley1555Notice` (`scopeVerified:false`) |
| Mora | `lateEAOn`, `defaultLateFor`; per-row `lateMinor`/`lateDays`/`lateBaseMinor`; card mora |
| Allocation | `allocate`, `applied[].allocation`, `planCommit` preview |
| Charges | per-row charge lines, `chargesMinor`, `taxesMinor` |
| Card | `projection.card`, statement rows, minimum rules |
| Change previews | `previewChange`, `restructureCarry` |
| Prepayment | `simulateExtra`, `compareStrategies`, `advise`, `buildFacts` |

**Nia write paths today**
- Create: loans only (`card_in_web`). Charges support `fixed|pctOutstanding|pctOriginal|pctOfSubtotal`; there is no `pctOfCharge`, so a fee plus its IVA cannot be expressed.
- `rate_change`.
- `charge_change`: set or remove only (`ADD_IN_WEB`).
- `late_policy`: loans and cards.
- `restructure`: loans only.
- `legal_rate`.

**Fields with no write path anywhere (web or Nia)**
- Card statement day and due day.
- Card minimum-payment rule, percentage and floor.
- Card limit and advance rate.
- `modality`.
- `prepaymentPenaltyPct`.
- `allocationOrder`.
- Mora base. Mora on the whole installment cannot be represented.

**Web**
- `AssistantPanel` is a disabled shell; there is no web endpoint for Nia.
- There is no "¿Qué es esto?" UI anywhere.

## Approaches

| Decision | Recommended | Alternatives |
|---|---|---|
| Topic selection | A1: `action:'explain'` plus a closed `topic` enum in extraction call #2, plus a folded-keyword router after classification that overrides `conversation` and `analysis` for glossary questions | A2: keywords only. A3: a third dedicated Gemini call. |
| Content | B1: deterministic Spanish templates over code-built facts. Legal constants live in `facts.text` with `sources` and `reviewedOn`. A guarded paraphrase can come later. | B2: free-form Gemini (rejected). B3: paraphrase from day one. |
| Placement | C1: Nia-local `functions/nia/debt/explain/` over public core APIs. Only the card revolving-base exposure is added to the core. | C2: facts in core. C3: a new shared package. |
| Advisor | D1: extraction-first `proposeSetup(case)` returning a draft, `assumptions[]`, `questions[]` and a core preview, then handing off to the existing pending → Confirm. Adjustments run as a sequential chain. | D2: a button wizard. D3: recommend only, then hand off to the web. |
| Follow-ups | A tiny `{topic, debtId}` session marker plus stateless read-only `nia:exp:<topic>:<debtId>` buttons that bypass the stage check | |
| Length | Plain text of about 1,200 characters or less. Detail goes behind buttons; split rather than cut. | |
| Web | Telegram first. "¿Qué es esto?" popovers come in a later slice. Enabling web chat is out of scope. | |

## Topic catalogue

| Topic | Facts source |
|---|---|
| `rate_conventions` | `rateInForce` or the stated rate, `convertRate`, `rateLabel`, `periodicRate` |
| `usury_ibc` | `capOn`, `usuryNotice` (with a modality caveat and the stale warning) |
| `mora` (loan and card) | `lateEAOn`, row late fields, `lateInterestMinor` (with the W4 caveat for cards) |
| `payment_allocation` | `allocate`, `applied[].allocation`, `previewPay` |
| `charges` | charge lines, yearly sum by kind |
| `card_statement` | `projection.card`, last statement row, minimum rule |
| `card_interest_drop` | needs an additive core exposure of the revolving base and excluded base per statement |
| `restructure_whatif` | `restructureCarry` |
| `prepayment` | `compareStrategies`/`advise` facts, `ley1555Notice` |

## Slice plan (each slice ≤2000 lines, commit groups ≤800, strict TDD)

| Slice | Content | Approx. lines |
|---|---|---|
| S0 | `explain` plumbing, router and safety net, topic menu, guard rejects spelled-out numbers, classifier boundary | 700 |
| S1 | Loan topics: rates, usury, mora, allocation, charges | 1,200 |
| S2 | Card topics, plus the core revolving-base exposure and a what-if for paying the minimum | 900 |
| S3 | Restructure what-if, prepayment, Ley 1555, optional guarded paraphrase | 800 |
| S4 | Advisor create: card create, fee + IVA presets, minimum rule, mora, convention, `proposeSetup` | 1,500 |
| S5 | Advisor adjust: checklist plus chained steps, `charge_change` add via presets, messages for unsupported cases | 1,200 |
| S6 | (optional) Web "¿Qué es esto?" popovers | 900 |
| S7 | Docs, `/ayuda` | 200 |

## Testing

- **Facts:** built from real core results, with explicit expected values.
- **Templates:** a property test checks that every number in a rendered template is allowed by its facts.
- **Guard:** cover faithful output, a changed digit, an invented figure, a spelled-out number, and a timeout.
- **Flows:** run in the handler `world()` harness. Explain must never write. A pending Confirm must survive an explanation. Stale explain buttons must be handled.
- **Routing:** glossary questions are overridden to explain, while "pagué la mora" stays a payment.
- **Advisor:** a table of cases. The Bancolombia card example must produce exactly one write after Confirm.

## Risks

- Legal and educational accuracy of the GMF exemptions, usury legal basis, Ley 546 and Ley 1555. Mitigation: deterministic templates, sourced constants with `reviewedOn`, and owner review.
- Existing unguarded `conversation` and `analysis` replies.
- Guard blind spots.
- Advisor write gaps. Some need new forward-compatible core events.
- Correcting a wrong saved configuration is hard today.
- Latency of 2–3 Gemini calls against the Appwrite timeout, which is not visible in the repo.
- Pending size for multi-step proposals.
- Approximations must be labelled "aproximado".
- Depends on `rateInForce`, which is already merged.
- The usury table has a single row, so the stale warning will be frequent.
- Privacy: amounts are sent to Gemini, as with `advise` today.

## Open questions for the owner

1. Should Nia create cards and add charges (fee + IVA, insurance) end-to-end? Recommended: yes, with presets.
2. Templates first, then a guarded paraphrase? Recommended: yes.
3. Who signs off the legal and educational copy? Is "informativo, no es asesoría" acceptable?
4. Add a new additive "terms correction" event (card cycle days, minimum rule, convention, modality), or keep archive-and-recreate plus a backdated `rate_change`?
5. Read statements from a photo or PDF? Recommended: defer.
