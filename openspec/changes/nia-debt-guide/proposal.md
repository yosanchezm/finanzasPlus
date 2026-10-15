# Proposal: Nia debt guide (explain and configure)

Nia explains every debt concept (interest, rate conventions, mora, usury, charges, card statements, restructures, prepayment) with the user's real numbers. It also sets up or corrects the debt to match the user's case. Every number comes from code. Gemini never produces a figure.

## Intent

| Gap today | After this change |
|---|---|
| Glossary questions fall into the `conversation` or `analysis` intents, which return free, unguarded Gemini text. | A deterministic `explain` answer built from code facts, with a source line and a disclaimer. |
| Nia cannot create cards (`card_in_web`) or add charges (`ADD_IN_WEB`), and a fee plus its IVA cannot be expressed in Nia. | Nia creates cards and adds charges end-to-end from presets. |
| No path anywhere fixes a wrong statement day, due day, minimum rule, convention or modality. | An additive `terms_correction` event, available from the web and from Nia. |

## Decisions (owner-approved)

| # | Rule |
|---|---|
| 1 | Nia creates cards and adds charges with presets: management fee plus IVA (`pctOfCharge` 19), life insurance, other insurance and GMF 4x1000. `card_in_web` and `ADD_IN_WEB` are lifted. |
| 2 | Explanations use deterministic Spanish templates over code-built facts. A guarded Gemini paraphrase comes later, and the guard will reject spelled-out numbers and cap length. |
| 3 | Every explanation shows its source line and «Información educativa con tus datos; no es asesoría financiera.» Legal copy (GMF, usura/IBC, Ley 1555, Ley 546, mora) lives in reviewed constants with `sources` and `reviewedOn`. **Owner gate:** the owner reviews the copy before the first deploy of explanation topics. |
| 4 | An additive `terms_correction` event fixes the card statement day, due day, minimum rule/pct/floor, rate convention (as the bank states it) and modality. There is no archive-and-recreate. Older bundles skip the unknown kind (AD1). |
| 5 | Reading statements from a photo or PDF is deferred. |
| 6 | Telegram comes first. Web «¿Qué es esto?» popovers are the optional last slice. Web Nia chat is out of scope. |
| 7 | Order: explain-only (read-only) → advisor (create, then adjust through the existing confirm flows, run as a sequential chain) → popovers → docs. |

## Scope

**In scope**
- `explain` action, topic enum and router
- Facts builders, templates and sourced constants
- `nia:exp:` buttons and the topic marker
- Additive core exposure of the card's revolving base
- `terms_correction` in the core, the web («Corregir datos») and Nia
- Advisor create and advisor adjust
- Guard hardening
- Optional popovers, then docs and `/ayuda`

**Out of scope**
- Statement OCR
- Web Nia chat
- Guarding all remaining `conversation` and `analysis` replies
- Write paths for the card limit and advance rate, `prepaymentPenaltyPct`, `allocationOrder` and mora base (Nia answers «no soportado»)
- Mortgage Ley 546 computation (explained only)
- Automatic fetching of legal rates

## Capabilities

### New

- `debt-explanations`: the topic catalogue (`rate_conventions`, `usury_ibc`, `mora`, `payment_allocation`, `charges`, `card_statement`, `card_interest_drop`, `restructure_whatif`, `prepayment`). Also covers facts builders, templates, reviewed constants (`sources`, `reviewedOn`), the disclaimer, «aproximado» labels and the length limit (about 1,200 characters, split rather than cut). It is channel-agnostic.
- `nia-debt-advisor`: `proposeSetup(case)` returns a draft, `assumptions[]`, `questions[]` and a core preview, then hands off to the existing pending → Confirm flow. Also covers presets, card create, and adjustments run as a sequential chain.

### Modified

| Capability | Change |
|---|---|
| `nia-debt-assistant` | `explain` action and keyword router overriding `conversation`/`analysis`; stateless read-only `nia:exp:<topic>:<debtId>` callbacks; `{topic, debtId}` marker; card create; `charge_change` add; `pctOfCharge` in extraction; Nia correction action; the guard rejects spelled-out numbers and caps length |
| `debt-ledger` | `terms_correction` kind: validate, replay, preview, void and summary |
| `credit-card-debt` | Revolving base and excluded base per statement, exposed additively; corrected card terms |
| `debt-web-management` | «Corregir datos» dialog, history summary, «¿Qué es esto?» popovers |

These are deltas against `debt-management/specs/*` and `debt-plan-changes/specs/*`, which are not archived.

## Approach

| Area | Approach |
|---|---|
| Routing | `ACTIONS += explain`, with a closed `topic` enum in call #2. A folded-keyword router runs after classification and moves glossary questions into `debt`/`explain`. «pagué la mora» stays a payment. |
| Content | `functions/nia/debt/explain/` builds facts over public core APIs (`convertRate`, `capOn`, `lateEAOn`, `allocate`, `restructureCarry`, `compareStrategies`). Templates render only digits that come from the facts, and a property test enforces this. |
| Session | `inform()` never touches the pending action. Buttons are stateless, read-only and skip the stage check. |
| Advisor | Extraction-first `proposeSetup`. Writes go through `confirmDebt` → `COMMIT[action]` (exactly once). A multi-step plan runs as a chain: one pending, one Confirm, then the next step. |
| Correction | A new event kind stored in the existing `debt_events` (`kind` is `string(24)`, payload in `payloadJson`). Design decides between retroactive and effective-dated semantics. |

## Affected areas

| Area | Impact |
|---|---|
| `packages/finance-core/` (`ledger/events.js`, project/replay, card) | Modified: `terms_correction`, revolving-base exposure |
| `functions/nia/index.js` | Modified: router, `nia:exp:` dispatch |
| `functions/nia/debt/` (`extract`, `handler`, `guard`, `planChange`, new `explain/`, `advisor`) | New / Modified |
| `src/features/debts/` (correction dialog, `eventSummary`, popovers) | New / Modified |
| Appwrite schema / `scripts/migrate-appwrite.mjs` | **None.** No migration (confirmed: string `kind` and `payloadJson`). |
| `docs/`, `/ayuda` | Modified |

## Slice plan (stacked to main, ≤2000 lines per slice, ≤800 per commit group, strict TDD)

| Slice | Content | Depends on | Lines (approx.) |
|---|---|---|---|
| S0 | Explain plumbing, router, topic menu, guard hardening, classifier boundary | none | 700 |
| S1 | Loan topics: rates, usury, mora, allocation, charges | S0 | 1,200 |
| S2 | Card topics, core revolving base, what-if for paying the minimum | S1 | 900 |
| S3 | Restructure what-if, prepayment, Ley 1555; optional guarded paraphrase | S1 | 800 |
| **Gate** | **Owner copy review of the legal constants (`reviewedOn` set). This blocks the first deploy of S1–S3.** | S1–S3 | none |
| S4 | `terms_correction`: core event, web «Corregir datos», history | none | 1,000 |
| S5 | Advisor create: card create, presets, `pctOfCharge`, minimum rule, mora default, convention echo | S1 | 1,500 |
| S6 | Advisor adjust: checklist and chain, `charge_change` add, Nia correction, «no soportado» messages | S4, S5 | 1,200 |
| S7 | Web popovers (optional, its own commit group), then docs and `/ayuda` | S1–S6 | 1,100 |

## Deploy order

1. **S0–S3.** Deploy the Nia tarball only, after the gate.
2. **S4 onward.** Deploy the web and Nia **together**. An old bundle skips `terms_correction` and would show the uncorrected terms.
3. **Migration.** None.

## Rollback plan

- **Code.** Revert the slices and redeploy the previous web build and tarball together.
- **Explain slices (S0–S3).** These are read-only, so no data is affected.
- **`terms_correction` events.** An older core skips them (AD1), so the debts fall back to their pre-correction terms. Void the corrections first if the old values must not reappear silently.
- **Cards and charges created by Nia.** These are ordinary rows and events, and they stay valid.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Legal or educational copy is inaccurate | Med | Sourced constants, `reviewedOn`, owner gate, disclaimer |
| Guard blind spots (spelled-out numbers, claims without digits) | Med | Templates first; harden the guard before any paraphrase |
| Latency of 2–3 Gemini calls against the function timeout | Med | Explain adds no extra call; the paraphrase is optional and has a timeout |
| Advisor drafts exceed the 1500-byte pending limit | Med | The chain holds one step per pending; drafts are rebuilt at Confirm |
| A retroactive correction changes history and costs | Med | Preview before and after; reconcile; design decides the semantics |
| The usury table is stale (single row) | High | Stale warning in the facts; never block |
| Approximations are taken as exact | Low | «aproximado» label and source line |

## Success criteria

- [ ] «¿qué es NAMV?» with a stated 25.2% NAMV explains 2.1% MV ≈ **28.32% EA**, with the source line and the disclaimer.
- [ ] Mora: 199,505 overdue 10 days at 28.59% EA → **1,375**.
- [ ] The owner's Bancolombia card (2.1% MV, fee 45,000 + IVA 19%) produces a proposed card that:
  - echoes ≈28.32% EA;
  - links IVA **8,550** to the fee through `pctOfCharge`;
  - sets the mora default to usury;
  - asks for the statement day, the due day and the minimum rule;
  - performs **exactly one write** after Confirm.
- [ ] Explain never writes, a pending Confirm survives an explanation, and stale `nia:exp:` buttons answer safely.
- [ ] A correction from the web or Nia changes the statement day or minimum rule without recreating the debt. Old bundles still read the debt.
- [ ] `npm test` and `npm run build` pass, and the Nia tarball deploys.

## Proposal question round (owner review)

The assumptions apply until the owner answers.

1. **Correction semantics.** Does a correction rewrite history as if the terms had always been right, or apply from a date? *Assumption: retroactive by default, because it fixes an input error. A real-world change still uses `rate_change`.*
2. **Owner gate.** Does the gate cover only the legal constants, or every template? *Assumption: legal constants plus one sample per topic.*
3. **Advisor gaps.** For fields with no write path (card limit, mora base), should Nia only explain them, or send the user to the web? *Assumption: explain them and say «no soportado aún».*
4. **Unknown statement or due day in the advisor.** Should Nia block creation or save a provisional value? *Assumption: ask once; if the user does not know, block creation for cards.*
