# Design: Nia debt guide (explain and configure)

Explanation facts and the reviewed legal copy move into the pure core, under `packages/finance-core/src/explain/`. This gives Telegram and the later web popovers one source of numbers and one reviewed text. Nia keeps the Spanish templates, the glossary router and the stateless `nia:exp:` buttons. The advisor reuses the existing pending → Confirm → `COMMIT[action]` path. Charge presets move into the core so the web wizard and Nia build the same charges. `terms_correction` is a new retroactive event kind. It is bound to the terms version in force when it was recorded, folded into the terms before replay, and skipped by older bundles (AD1). **Appwrite schema: no migration.** The new kind is stored in the existing `debt_events.kind` `string(24)` and its payload in `payloadJson`.

> Size note: the orchestrator asked for six detailed areas, so this design deliberately goes over the 800-word skill budget, as the `debt-plan-changes` design did. Most of the detail is in tables.

## Quick path (review order)

1. Architecture decisions (AD table).
2. `terms_correction` semantics and the compatibility matrix (they gate the deploy order).
3. Interfaces: explain facts, router and buttons, advisor, presets, correction.
4. Per-slice file map, tests, owner gate and deploy order.

## Architecture Decisions

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| G1 | **Facts builders and reviewed copy live in the core** (`packages/finance-core/src/explain/`). The Telegram templates stay in Nia (`functions/nia/debt/explain/render.js`). S7 web popovers render their own short JSX from the same facts and copy. | Nia-local facts (explore C1): S7 could not import them (`functions/` is not in the web graph), so the legal copy would be duplicated and reviewed twice. A new shared package: package.json, Vite alias and Nia packaging cost for no gain. | One reviewed text and one set of numbers per topic. The builders depend only on core APIs (`convertRate`, `capOn`, `lateEAOn`, `planCommit`, `restructureCarry`, `compareStrategies`). Rendering is channel-specific, because Telegram length and popover length differ. **This deviates from the proposal's "Content" row (Nia-local).** |
| G2 | **Routing.** `ACTIONS += explain, setup, terms_correction`, with a closed `topic` enum in call #2. A folded-keyword router (`glossaryTopic`) runs in `index.js` after `intentFor`, only when the intent is `conversation` or `analysis` and there is no attachment. It moves the message to `handleDebt` with `explainHint`. A question cue plus a concept keyword is required. Write verbs veto. | Keywords only; a third dedicated Gemini call | The model still resolves the debt and the stated rate in call #2. A vetoed message ("pagué la mora") keeps its original intent. Explain adds no call beyond classification and extraction. |
| G3 | If the extraction returns a write action while `explainHint` is set, **the extraction wins**. An `explainHint` combined with a read-only action (`list`, `advise`, unknown) becomes `explain`. | Trusting the hint | The extraction saw the whole text, and every write still needs Confirm. |
| G4 | **Session marker inside the history.** `turn()` writes `{ role:'assistant', content, explain:{ topic, debtId } }`. `lastExplain(history)` reads only the **last** assistant entry. | A new key in `bot_sessions` JSON, which changes `saveSession` and all of its callers | The pending stays untouched. Any later reply expires the marker for free. `serialiseSession` already keeps unknown keys, and adds about 60 bytes. |
| G5 | **Stateless buttons** `nia:exp:<topic>[:<debtId>]` use full topic names (at most 8 + 18 + 1 + 36 = 63 bytes). They are routed in `index.js` **before** `handleDebtCallback`, so there is no stage check. A missing, deleted or out-of-scope debt (`inScopeFor`) gets a short safe reply. | Short topic codes; reusing `nia:pick` (needs a pending stage) | Matches the spec literally and stays read-only. A pick between debts for an explanation uses `nia:exp:<topic>:<id>` buttons too, so no pending is created. |
| G6 | **Length (follows the spec "Length and splitting").** `renderExplain` returns `parts[]`, each at most 1,200 characters, split on paragraph boundaries and never inside a number. Only part 1 is sent, with the footer (source line plus disclaimer). The detail beyond it is offered behind buttons: «Ver más» `nia:exp:<topic>:<debtId>:<n>` (stateless, re-renders and sends part *n* with its own footer), plus at most 2 related-topic follow-ups `nia:exp:<topic>[:<debtId>]`. The longest callback is checked: `nia:exp:card_interest_drop:` plus a 36-character id plus `:2` is 65 bytes, so for page buttons `button()` drops the debt id to `-` when the full form would pass 64 bytes, and the handler then resolves the debt from the marker. | Sending every part at once (contradicts the spec) | The spec offers the detail beyond the first message behind follow-up options. Each message keeps its footer, and no number is cut. |
| G7 | **Hardened guard.** `guardParaphrase(reply, facts, extra, { maxChars = 1200 })` also rejects `NUMBER_WORDS` (dos…noventa, cien/ciento, -cientos, mil, millón/millones, billón, doble, triple, mitad). The default cap drops from 4,096 to 1,200 for **all** paraphrases. «un», «una» and «uno» are not listed, because they are articles. | Keeping 4,096 for advise | The spec caps every message at 1,200. A false rejection only falls back to the template, so the cost is asymmetric and safe. |
| G8 | **Copy gate.** `EXPLAIN_COPY[key] = { text, sources[], reviewedOn, reviewedHash }`. A key is reviewed when `reviewedOn` is set **and** `fnv1a(text + sources)` equals `reviewedHash`, so any edit after review un-reviews it. A key listed by `topicCopyKeys(topic)` but **missing** from `EXPLAIN_COPY` counts as **unreviewed**. `releasedTopics()` lists the topics whose keys are all present and reviewed. An unreleased topic replies «Este tema está en revisión» (spec). `scripts/check-explain-copy.mjs` runs inside `package:nia` (and `build` from S7) and fails while anything is unreviewed. `NIA_ALLOW_UNREVIEWED=1` is the explicit override, used for the S0 package (it releases no topic) and for hotfix deploys before the gate. | A unit test that fails before the gate, which would break TDD runs; a manual checklist only | A mechanical gate with no red `npm test`. The hash stops silent edits from shipping. FNV-1a is about 15 lines and is Node16- and browser-safe. |
| G9 | **`terms_correction` is retroactive and version-bound.** `buildCorrection` stamps `appliesTo`: `'opening'`, or the id of the last active `restructure` dated on or before `on`. `project()` folds the `'opening'` corrections into the base terms. The loan `applyRestructure` folds the corrections whose `appliesTo` equals its event id into the new terms. Folding ignores `asOf`: all active corrections count, and voids are honoured. | Effective-dated corrections; editing `termsJson`; applying corrections to whatever terms are current | Matches the spec "start of the terms version in force when recorded, regardless of the event date". Later `rate_change` events replay on top unchanged. Cards have no restructure, so they always use `'opening'`. |
| G10 | Corrections are **stripped from the event list** handed to the projectors. When any exist, `projection.corrections = [{ eventId, appliesTo }]` is added. A stored correction that no longer validates, or whose restructure was voided, is skipped with `terms_correction_skipped {eventId, reason}`. | Projector handlers per kind | Projectors stay untouched. The field is added only when non-empty, so existing deep-equal goldens still pass. |
| G11 | **Writer strictness.** `normalizePayload('terms_correction')` accepts only `rate`, `modality` and `card.{statementDay, dueDay, minPayment.{rule,pct,floorMinor}}`. Any other key throws `correction_unsupported_field`. `buildCorrection` throws `correction_empty`, `correction_not_applicable` (card fields on a loan) and `no_change`. `planCommit` and `previewChange` run `applyCorrection` on the version terms before projecting, so invalid terms throw. | Lenient payloads | The spec's typed errors; nothing invalid is ever written (AD1 philosophy). |
| G12 | **Presets in the core** (`src/chargePresets.js`): `CHARGE_PRESET_SPECS` (kind, basis, label, cadence, refId, requires, default) and `presetCharges` / `addPresetCharge`. `cadence` is validated by the core (`terms.js:51`) and defaults to `per_installment`, as the wizard writes today. `charge_change` add accepts a preset **or** explicit fields (`kind`, `label`, `basis`, `value`, `cadence`, `refLabel` for `pctOfCharge`). Both are validated against the resulting set through `normalizeCharges`. The web `CHARGE_PRESETS` keeps only UI fields (unit, placeholder) and spreads the core spec. `cardCharges` calls `presetCharges(…, { card:true })`, which keeps the stored ids `mgmt_fee` / `mgmt_iva` and the label «Cuota de manejo». | Copying the presets into Nia (as `chargesInForce` was) | One builder for the IVA `pctOfCharge` link. Stored ids and labels do not change, so old cards stay identical. |
| G13 | **The advisor is extraction-first and stores overrides only.** `proposeSetup` is pure. The pending stores the merged `case` (at most 1.5 KB), and the terms are rebuilt at Confirm (AD14 precedent). Text answers to questions are merged into the stored case (`mergeCase`); the history is not relied on to re-extract them. | Re-extracting from the history; a button wizard | Deterministic, testable, and small pendings. |
| G14 | **Chain.** After a step's Confirm succeeds, the next step is previewed **immediately** against the live debt with a **fresh pending id**, so each step's pending has its own `dedupeKey` (`debt:{pendingId}`) and event id (`de{pendingId}`). Its Confirm button is `nia:confirm:<pendingId>`, and `confirmDebt` rejects an id mismatch with «Ese paso ya quedó registrado». A step that fails stops the chain: its preview or rebuild is invalid, it returns a `ValidationError`, or the commit fails. Nia then reports the steps done and the steps not run, and writes nothing more. `nia:cancel` on a chain pending stops it with the same report. | Plain `nia:confirm` (a double tap would confirm step 2); a «Continuar» button (the spec wants the next preview right away) | Exactly one write per step and per Confirm. The old `nia:confirm` without an id keeps working for every other flow. |
| G15 | **Card creation from Nia** writes only the `debts` row `db{id}` (as the web's `saveLoan`: "a card has no disbursement"), and a `409` means duplicate. Loan creation keeps its current contract: the debt row plus its `disbursement`. `limitMinor` is never written. | A disbursement for cards | It follows the web and the amended spec "Exactly one write after Confirm". |

## `terms_correction` semantics and compatibility

```
project(debt, events, asOf)
  readEvents ─► known ─┬─► active corrections (ALL dates, voids honoured, sortEvents order)
                       │     opening ones ─► applyCorrection(baseTerms) ─► terms
                       │     restructure-bound ones ─► kept for applyRestructure(eventId)
                       └─► known − corrections ─► filter ≤ asOf ─► activeEvents ─► projector(terms)
```

| Data present | Bundle before S4a | Bundle at or after S4a |
|---|---|---|
| `terms_correction` | Skipped with `unknown_event_kind`. The debt reads with uncorrected terms, and reconcile is skipped (AD2). | Honoured |
| A void of a correction | No effect (AD1: unknown target) | Restores the previous terms |

- **Card cycles.** A corrected `statementDay` re-cuts every cycle from opening. Stored statement `adjustment` events dated on old statement days can then show `drift`. The web dialog and Nia preview warn: «Tienes N extractos registrados; revisa que coincidan».
- **Void.** Voiding is allowed, and it is not blocked by later events.

## Interfaces / Contracts

### Core explain (`packages/finance-core/src/explain/`)

```js
EXPLAIN_TOPICS = ['rate_conventions','usury_ibc','mora','payment_allocation','charges','card_statement','card_interest_drop','restructure_whatif','prepayment']
TOPIC_KINDS    // card-only: card_statement, card_interest_drop; loan-only: restructure_whatif, prepayment
EXPLAIN_COPY   // { [key]: { text, sources: [{label, url?}], reviewedOn: 'YYYY-MM-DD'|null, reviewedHash: string|null } }
topicCopyKeys(topic) → string[]          // legal keys plus one sample key per topic (owner Q2)
copyStatus(copy = EXPLAIN_COPY) → { reviewed: string[], unreviewed: string[] }
releasedTopics(copy = EXPLAIN_COPY) → topic[]
explainFacts(topic, debt|null, events, legal, today, opts = { stated?: Rate, amountMinor?, copy? }) → ExplainFacts
  // unknown topic → throws ValidationError('unknown_topic', {topics})
ExplainFacts = { topic, asOf, status: 'ok'|'generic'|'not_applicable'|'under_review',
  debt: { id, name, kind: 'loan'|'card' } | null, dataSource: 'debt'|'stated'|'generic',
  numbers: {k: number}, text: {k: string},     // every printable figure, pre-formatted: "$ 1.375", "28,32 %"
  approximate: string[],                        // text keys rendered with «aproximado»
  notices: [{ code }],                          // usury_stale, cap_unknown, late_mortgage_unverified, ley1555_scope_unverified…
  copy: string[], sources: [{label,url?}], reviewedOn }
allowedTexts(facts, copy = EXPLAIN_COPY) → string[]   // facts.text + copy texts + source labels (for the guard and the property)
```

| Topic | Facts from | Goldens |
|---|---|---|
| `rate_conventions` | `opts.stated` or `rateInForce(project(...))`; `convertRate`, `periodicRate`, `rateLabel` | 25.2 % NAMV → 2.1 % MV → 28.32 % EA |
| `usury_ibc` | `capOn(legal.usuryTable, modalityOf(terms), today)` (stale, origin, ibcEA), `usuryNotice` | Stale cap shown, never blocks; mortgage explained only (Ley 546) |
| `mora` | `lateEAOn`, plan rows `lateMinor`/`lateDays`/`lateBaseMinor`; card `lateInterestMinor` marked approximate | 199,505 × 10 days at 28.59 → 1,375 |
| `payment_allocation` | `planCommit(payment draft, eventId 'explain')`, a pure preview | 100,000 → 10,000 / 90,000 / 0; with mora → 10,000 / 1,375 / 88,625 / 0 |
| `charges` | Next row `charges` lines, a yearly sum over the next 12 rows (approximate), GMF copy | IVA 8,550; GMF 400,000 → 1,600 |
| `card_statement` | `projection.card`, last plan row, `terms.card.minPayment` | — |
| `card_interest_drop` | New plan-row fields (below), plus a minimum-only what-if: `project` with a synthetic payment of the minimum on `dueOn` versus pay-in-full, measured at the next close (approximate) | 300,000 revolving; paid in full → base 0 |
| `restructure_whatif` | `restructureCarry` with and without `waiveLate` | 391,756 / 390,381 |
| `prepayment` | `compareStrategies`, `ley1555Notice` | 0 %, 12 installments, extra 300,000 → 8 / 11 installments |

**Card exposure (S2, additive, `card/card.js` `closeCycle`).** Plan rows gain three fields:

- `revolvingBaseMinor = max(base − lateExcluded, 0)`, the base the interest is computed on;
- `excludedBaseMinor = max(closedBilled − base, 0)`, the part of the previous statement paid by its due date;
- `lateExcludedBaseMinor`.

Here `base` is the effective base the close already uses, `state.interestBase ?? state.billed`. `interestBase` is never read directly, because it is `null` when the due date clamps onto the statement day. The state keeps `closedBilled` after each close. Existing fields do not change.

### Nia explain (`functions/nia/debt/explain/`)

```js
glossaryTopic(text, { released, marker }) → { topic } | null      // router.js; fold() from findDebt.js
renderExplain(facts, { maxChars = 1200 }) → { parts: string[], followUps: topic[] }   // render.js, per-topic templates
startExplain(deps, ctx, { topic, debtRef, stated, amountMinor })   // flow.js; uses inform-style save (pending = ctx.previous)
handleExplainCallback(deps, ctx, data)                              // ctx: { previous: session pending, sessionStatus }
lastExplain(history) → { topic, debtId } | null
explainButton(topic, debtId?, page?) / parseExplainCallback(data)   // pending.js; ≤ 64 B asserted by button(); page n ≥ 2 = «Ver más»
```

- **Router.**
  - Question cue: `¿`/`?`, or a leading `que|como|cual|cuanto|por que|explica(me)|que significa|para que sirve|diferencia`.
  - Concept keywords map to topics, for example `namv|nominal|efectiva|mes vencido` → `rate_conventions`, `usura|ibc` → `usury_ibc`, `mora|moratorio` → `mora`, `4x1000|gmf|cuota de manejo|iva|seguro|cargo` → `charges`, `corte|extracto|pago minimo` → `card_statement`, `(bajo|subio|bajaron) .*interes` → `card_interest_drop`, `reestructur|refinanci` → `restructure_whatif`, `abono a capital|prepag|ley 1555` → `prepayment`.
  - Veto: `pague|abone|registra|anota|crea|agrega|cambia|quita|configura|activa`.
  - Marker rule: a question cue, at most 60 characters, no concept keyword, and a marker present give the marker's topic.
  - Unreleased topics still route; the reply is then «en revisión».
- **Footer.**
  ```
  Fuente: <debt name | "tasa que me diste"> · <core family> · <copy source labels>
  Información educativa con tus datos; no es asesoría financiera.
  ```
- **Never writes.** The `world()` tests assert zero `createRow`, `updateRow` and `deleteRow` calls, and that `saveSession` receives the same pending.

### Advisor (`functions/nia/debt/advisor/`)

```js
// extract.js: action 'setup' (a described case) and card support in 'create'; both normalize to request.setup
SetupCase = { kind, name, lender, principalMinor, openedOn, rate|null, rateValue, n, periodicity, system, firstDueOn,
  card: { statementDay|null, dueDay|null, minRule|null|'unknown', minPct, minFloorMinor },   // no limitMinor: a stated limit becomes mention 'card_limit'
  presets: { fee?: number|null, iva?: number /*19*/, ivaIncluded?: bool, life?: number|null, insurance?: number|null, gmf?: bool },
  charges: Charge[] /* raw, pctOfCharge with refLabel resolved by code */, lateStated: 'usury'|'fixed'|'none'|'whole_installment'|null,
  mentions: ('card_limit'|'advance_rate'|'prepayment_penalty'|'allocation_order'|'mora_base')[] }
proposeSetup(setupCase, debts, legal, today) → {
  mode: 'create'|'adjust', draft: { setup } | null,
  steps: [{ action: 'terms_correction'|'rate_change'|'charge_change'|'late_policy', draft, label }],   // corrections first
  assumptions: [{ code, text }],      // iva_19, mora_default_usury, opened_today…
  questions: [{ field: 'statementDay'|'dueDay'|'minRule'|'convention'|'amount:<preset>'|'fix_or_change', options?: string[], blocking: true }],
  unsupported: [{ code, text }],      // «no soportado aún», e.g. mora on the whole installment, card limit (create or change)
  preview: { eaText, rateLabel, chargeLines: [{label, amountText}], minimumText?, nextStatementOn?, usuryLines } | null }
buildCardTerms(setupCase) → validated DebtTerms        // cardTerms.js: system 'none', monthly, late default usury, presetCharges(card)
mergeCase(stored, extracted) → SetupCase              // later answers fill nulls; a stated value overrides
```

- **Buttons.** `nia:min:<rule>` (`awaiting:'minimum'`), `nia:adj:fix|change` (`awaiting:'adjust_kind'`), and `nia:conv:*` through `CONVENTION_NEXT.setup`.
- **Confirm gating.** No Confirm keyboard is sent while a blocking question is open.
- **Unknown cycle days.** An «no sé» for a statement or due day after one ask blocks the creation and names the missing data.
- **Unknown minimum rule.** The rule is asked with the `nia:min:` buttons and is never defaulted or saved as a provisional value. Until it is answered there is no Confirm. An «no sé» after one ask blocks the card creation and says where to find it (the statement or the contract).
- **Card limit.** It is not written at creation. A stated limit is answered with «no soportado aún» and the card is created without `limitMinor`.

### Presets (`packages/finance-core/src/chargePresets.js`)

```js
CHARGE_PRESET_SPECS = { life:{kind:'insurance',basis:'pctOutstanding',cadence:'per_installment',label:'Seguro de vida'}, insurance:{kind:'insurance',basis:'fixed',cadence:'per_installment',label:'Otro seguro'},
  fee:{kind:'fee',basis:'fixed',cadence:'per_installment',label:'Comisión o cuota de manejo'}, iva:{kind:'tax',basis:'pctOfCharge',cadence:'per_installment',refId:'fee',requires:'fee',defaultValue:19,label:'IVA sobre la comisión'},
  gmf:{kind:'tax',basis:'pctOfSubtotal',cadence:'per_installment',defaultValue:0.4,label:'GMF (4 x 1000)'} }
presetCharges(selected /* {key: number} */, { card = false }) → Charge[]   // card: ids mgmt_fee/mgmt_iva, labels «Cuota de manejo»/«IVA»; normalizeCharges
addPresetCharge(charges, key, value, { card }) → Charge[]   // throws preset_exists, preset_requires_fee; IVA links to the single existing fee
addExplicitCharge(charges, { kind, label, basis, value, cadence = 'per_installment', refLabel? }) → Charge[]   // refLabel resolved by folded label; throws charge_ref_unknown
```

When the IVA is included (`ivaIncluded`), the fee is `round(stated / 1.19)` and is labelled «aproximado» in the assumptions.

### Correction (`packages/finance-core/src/ledger/correction.js`)

```js
event terms_correction: amountMinor 0, effectiveOn = recording date,
  payload { fields: CorrectionFields, previous: CorrectionFields, appliesTo: 'opening' | restructureEventId }
CorrectionFields = { rate?: Rate (as stated), modality?: LEGAL_MODALITIES item, card?: { statementDay?, dueDay?, minPayment?: { rule?, pct?, floorMinor? } } }
versionTermsAt(debt, events, on) → { appliesTo, terms }        // internal: base or restructure terms, plus their corrections
applyCorrection(terms, fields) → validated DebtTerms           // throws correction_not_applicable, invalid_card, invalid_terms
buildCorrection(debt, events, fields, { on }) → draft          // fills previous and appliesTo; throws correction_empty, no_change
previewChange(..., { kind: 'terms_correction' }) adds corrected: { before, after }   // field values, additive
```

- **Barrel and node16 exact keys.** Adds `EXPLAIN_TOPICS`, `EXPLAIN_COPY`, `explainFacts`, `releasedTopics`, `copyStatus`, `allowedTexts`, `CHARGE_PRESET_SPECS`, `presetCharges`, `addPresetCharge`, `addExplicitCharge`, `buildCorrection`.
- **Reconcile after a correction.**
  - Web: save and void run `afterSave: reconcileAfter` (`PLAN_CHANGE_KINDS` includes `terms_correction`), as for the other plan changes.
  - Nia: it does not reconcile (AD15 precedent). When `impacted.length > 0`, the preview and the Confirm reply add the backdated note «Los costos de pagos anteriores se actualizarán cuando abras la deuda en la web.», and the web-open reconcile repairs the cost rows.
- **History summary.** `eventSummary`: `Corrección: día de corte 15 → 20 · pago mínimo 5 % → 3 %`.

## Owner copy-review gate

| Step | Who | What |
|---|---|---|
| G.1 | Owner | Reviews every `EXPLAIN_COPY` entry (the legal ones and one sample per topic) from `node scripts/check-explain-copy.mjs --print` |
| G.2 | Apply | One commit sets `reviewedOn` and `reviewedHash` for each approved key and adds `copy.release.test.js`. That test asserts that `releasedTopics()` equals the full catalogue, so any later unreviewed copy turns the suite red. |
| G.3 | Operator | `npm run package:nia` passes the check without `NIA_ALLOW_UNREVIEWED`, and only then is the tarball deployed. |

G.1–G.3 block the first deploy of S1–S3. Missing copy keys count as unreviewed, so the check fails for S0 by construction. S0 is packaged with the explicit override `NIA_ALLOW_UNREVIEWED=1 npm run package:nia`; the tasks and deploy notes of S0 must state it. S0 releases no topic, so the router answers «en revisión» only for glossary questions.

## File map by slice

Estimates include tests. Recent slices ran between 0.7× and 2× their forecast, so every slice above 650 lines has a valve. Commit groups stay at 800 lines or less.

| Slice | Files (C = create, M = modify) | Est. lines | Valve (commit groups) |
|---|---|---|---|
| S0 plumbing | C core `explain/{topics,copy,hash}.js` (catalogue, empty copy skeleton, `releasedTopics`, `copyStatus`), `scripts/check-explain-copy.mjs`; Nia C `explain/{router,flow,render}.js` (menu and «en revisión» only); M `extract.js` (`explain`, `topic`), `guard.js` (words, `maxChars`), `pending.js` (`explainButton`), `handler.js` (`turn` marker, route), `index.js` (router call, `nia:exp` before the stage check, classifier text), `package.json` (`package:nia` runs the check; the S0 deploy uses `NIA_ALLOW_UNREVIEWED=1`) + tests | 1,300 | S0a: core catalogue, guard, router, extraction (~650). S0b: flow, buttons, wiring, check script (~650) |
| S1 loan topics | C core `explain/facts/{rates,usury,mora,allocation,charges}.js`, `explain/allowed.js`, copy entries; Nia M `render.js` (5 templates, splitter, footer) + golden and property tests | 1,300 | S1a: core facts and copy (~700). S1b: render and property (~600) |
| S2 card topics | M core `card/card.js` (3 fields, `closedBilled`) + `card.base.test.js`; C `explain/facts/card.js` (statement, interest drop, minimum what-if); Nia render + tests | 900 | S2a: core (~450). S2b: Nia (~450) |
| S3 restructure and prepayment | C `explain/facts/{restructure,prepayment}.js`, Ley 1555 and 546 copy; Nia render; optional `explainParaphrase` (off by default: `config.explainParaphrase`) + tests | 800 | S3a: topics (~500). S3b: paraphrase (~300) |
| Gate | G.1–G.3 | — | — |
| S4 `terms_correction` | Core C `ledger/correction.js`; M `events.js` (kind, payload), `project.js` (fold, strip, `corrections`), `tail.js` (`applyRestructure` folds bound corrections), `preview.js` (kind, `corrected`), `commit.js`, barrel, node16 + tests. Web C `termsCorrectionModel.js`, `TermsCorrectionDialog.jsx`; M `MoreActionsMenu.jsx`, `DebtDetail.jsx`, `DebtDetailContainer.jsx` (`afterSave` reconcile), `debtDetailModel.js` (`VOIDABLE`, `PLAN_CHANGE_KINDS`), `eventSummary.js`, `EventHistory.jsx` + tests | 1,500 | S4a: core (~650). S4b1: model and summary (~400). S4b2: dialog and wiring (~450) |
| S5 advisor create | Core C `chargePresets.js` + test; web M `wizardModel.js` (spreads specs, `cardCharges` via core). Nia C `advisor/{propose,cardTerms,merge}.js`; M `extract.js` (`setup`, card fields, presets, `pctOfCharge` + `refLabel`), `handler.js` (`startSetup`, answers, `nia:min`, `commitSetup` card row or loan), `pending.js`, `preview.js`, `index.js` + tests | 1,700 | S5a: presets core and web plus extraction (~500). S5b: propose and card terms (~650). S5c: handler and wiring (~550) |
| S6 advisor adjust | Nia M `planChange.js` (`charge_change` add through `addPresetCharge` or `addExplicitCharge`; `ADD_IN_WEB` removed), `extract.js` (explicit add fields); C `correction.js` (extract, preview, rebuild at Confirm, dedupe pre-check, backdated note), `advisor/chain.js` (order, fresh pending and dedupe key per step, `nia:confirm:<id>`, a failed step or a cancel stops the chain and reports), `advisor/unsupported.js`; M `propose.js` (adjust checklist, `fix_or_change`), `handler.js`, `index.js` (`cancelPending` delegates debt chains, `nia:confirm:` regex) + tests | 1,300 | S6a: charge add and the correction action (~600). S6b: checklist, chain and unsupported (~700) |
| S7 popovers and docs | Web C `explain/WhatIsThis.jsx` (a disclosure like `MoreActionsMenu`, no new dependency), `explain/popoverModel.js`; M `DebtDetail.jsx`, `CardPanel.jsx`, `LateNotices.jsx`, `package.json` (`build` runs the check); docs `functions/nia/README.md`, `docs/`, `/ayuda` in `index.js` | 850 | S7a: popovers (~600). S7b: docs (~250) |

## Testing Strategy (strict TDD, RED first)

| Slice | RED-first tests | Approach |
|---|---|---|
| S0 | Router positives: «¿qué es NAMV?», «¿cómo funciona la mora?», «explícame la usura», «¿qué es el 4x1000?». Router negatives: «pagué la mora», «pagué 200.000 de mora», «abona 500.000 a capital», «registra la cuota de manejo», «qué es una acción en bolsa», «hola». Marker follow-up «¿y con ejemplo?». Guard: changed digit, «cuatro por mil», «veintiocho», over 1,200 characters, faithful, timeout. Callback at most 64 bytes for `card_interest_drop` plus a 36-character id. The menu and «en revisión» write nothing. A pending Confirm survives an explanation (same pending saved, and the Confirm then writes once). Stale or foreign `nia:exp`. | Unit; `handler.test.js` `world()`; `index.test.js` with a faked undici fetch (at most 2 Gemini calls) |
| S1–S3 | One golden per topic from **real core results** (table above). Not applicable and generic cases. Footer and exact disclaimer. «aproximado» labels. **Property**: seeded `mulberry32` over the fixture debts (loan, mora, card, mortgage, 0 % family) × topics × stated rates. Every number in `render` is in `allowedTexts`, there are no `NUMBER_WORDS`, every part is at most 1,200 characters, and `guardParaphrase(part)` is not null. A 2,500-character render splits without cutting. | Core unit (`// @vitest-environment node`); Nia render unit |
| S2 core | The F3 fixture keeps every old field (additive). 300,000 revolving; paid in full → base 0, excluded 800,000, interest 0; mora exclusion matches F3 (interest 10,392 → 9,526). | Unit |
| S4 | Spec scenarios: valid, not applicable, unsupported `limitMinor`, `no_change`, NAMV versus EA, a later `rate_change` keeps 22 %, two corrections then a void, preview equal to the saved projection, `impacted`, an older core skips it (`registerProjector`-free `readEvents` test with the kind removed), bound to a restructure, orphaned after a restructure void. Web: prefill, loan without card fields, no change disables save, double submit gives one event, the reconcile toast, summary 15 → 20. | Core unit; RTL with a mocked port |
| S5–S6 | Bancolombia case: 28.32 % EA echo, IVA 8,550 `pctOfCharge`, mora usury, questions for the cycle days and the rule, no Confirm while a question is open, exactly one `debts` row after two Confirms («ya estaba registrada»). Unknown statement day blocks. Unknown minimum rule blocks, with no default and no Confirm. Dangling `refLabel`. Missing preset amount. Missing convention gets buttons. Explicit-field add, and a preset add that reaches the set through `normalizeCharges`. Chain: correction then charge, the second previewed on the corrected debt; each step has its own `debt:{id}`; a double tap with the old id writes once; a failed step and a cancel both stop the chain and report done and remaining. A Nia correction with `impacted` shows the backdated note. Pendings at most 1,500 bytes. «no soportado aún» for the limit (no `limitMinor` written) and mora on the whole installment. G6: «Ver más» sends part 2 with its footer, and the page callback is at most 64 bytes. | `world()` plus wiring |
| S7 | Popover opens and closes with the keyboard, renders the footer, is hidden for unreleased topics, and writes nothing. | RTL |

**Node16.** New core files avoid `findLast`, `toSorted`, `toReversed`, `at(`, `structuredClone`, `Object.hasOwn`, `groupBy`. The `test/node16.test.js` source scan and the barrel exact-keys list change RED-first in S0a, S1a, S2a, S4a and S5a. The `package:nia` packaging scan covers `functions/nia/debt/explain` and `advisor`.

## Threat Matrix

| Boundary | Applicability |
|---|---|
| Documentation-like paths | N/A: no file classification or execution |
| Git repository selection | N/A: no Git automation |
| Commit state | N/A: no commit automation |
| Push state | N/A: no push automation |
| PR commands | N/A: no PR automation |

The new routing is chatbot intent routing, not process routing. Its safety cases (write vetoes, stale and foreign buttons, id-bound chain Confirm) are already listed as RED tests in S0 and S6.

## Migration / Rollout

1. **Schema.** No migration.
2. **S0.** Deploy the Nia tarball alone (no topic released), packaged with `NIA_ALLOW_UNREVIEWED=1 npm run package:nia`.
3. **S1–S3.** Deploy the Nia tarball only after gate G.
4. **S4.** Deploy the web build and the Nia tarball **together**. Nia must read corrections before the web can write them.
5. **S5.** Deploy Nia and the web (the preset refactor is behaviour-neutral).
6. **S6.** Deploy Nia; it writes corrections, so it needs the web from S4.
7. **S7.** Deploy the web.
8. **Rollback.** Revert slices and redeploy both runtimes together. Before rolling back S4, void any corrections whose old values must not reappear silently.

## Open Questions

- [ ] **Correction semantics (owner Q1).** This design implements the retroactive, version-bound reading of the spec. An effective-dated correction would need a different fold.
- [ ] **Advise paraphrase.** The 1,200 cap and the number words will make advise fall back to its template more often. This is accepted as safe; confirm it.
- [ ] **Usury table.** It has a single row, so the stale warning will be frequent in `usury_ibc` and `mora`.
