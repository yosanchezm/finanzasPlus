# Design: Debt plan changes, legal rates and late interest

This design extends the pure core in `packages/finance-core/` with four things: tolerance for unknown event kinds, legal tables that the household can edit, a `previewChange` API, and a mora engine that runs inside `project()`. The web and Nia keep their current write path (`planCommit` → `commitPlan`, `findSaved`, `debt:{pendingId}`). The schema change is a single additive table, `legal_rates`.

> Size note: the orchestrator asked for seven detailed areas, so this design goes over the 800-word skill budget on purpose. Tables carry most of the detail.

## Quick path (review order)

1. Architecture decisions (AD table).
2. Forward compatibility and the compatibility matrix (they gate every deploy).
3. Interfaces: legal, `previewChange`, mora.
4. Per-slice file map, tests and deploy order.

## Architecture Decisions

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| AD1 | **Forward compatibility in the readers, strictness in the writer.** `readEvents` (internal) skips events with a string `kind` outside `EVENT_KINDS`. `sortEvents`, `activeEvents` and `project` use it. `project` adds one `unknown_event_kind` notice per skipped event. `validateEvent` stays strict, so `planCommit` still refuses unknown kinds. Ships in A1, before `late_policy` exists. | Lenient `validateEvent`, which would also let writes through; a `try/catch` per debt in the callers | Readers must survive newer data, while writers must never produce data they cannot read. One change covers all 13 call sites. |
| AD2 | **Reconcile is skipped for a debt whose projection has `unknown_event_kind`.** | Reconciling anyway | An older bundle would push cost rows down (no mora), and the newer one would push them back up. Skipping prevents that flip-flop. |
| AD3 | `legal_rates` stores an integer `value`: **basis points** for `ibc`/`usury` and **pesos** for `smmlv`. Usury = `floor((ibcBp × 3 + 1) / 2)` bp (half up). | A `float` column (from the exploration) | Exact half-up rounding (1949 → 2924; 1906 → 2859) with no floating-point drift. Certified rates have 2 decimals. |
| AD4 | **An explicit usury row is the override.** For each (modality, month), the order is: `usury` row, then `ibc` × 1.5, then the code default. **Exception: `mortgage` is manual.** Its usury comes only from explicit `usury` rows (or a code default); an `ibc` row for `mortgage` is stored and listed but never derived. | An `override` flag column; deriving every modality | One row kind per fact, with no extra column (column sizes are immutable). Mortgage caps do not follow the 1.5 rule (spec "Mortgage is not derived"). |
| AD5 | Deterministic row id `lr{k}{mm}{yyyymm}{householdId[0..25)}` (k = kind initial, mm = modality code), plus a unique index. Create; a `409` becomes an update. | Random ids plus a lookup | Idempotent from the web and from Nia (the Confirm retry), with no read-before-write. |
| AD6 | Legal tables reach the core through `legalOf(debt, opts)`, in this order: `opts.legal`, then `debt.legal`, then `DEFAULT_LEGAL`. The loaders decorate debts (`useDebtData.load` and Nia `loadDebts`). The wizard and Nia's `previewCreate` (which have no debt yet) pass `{usuryTable}` explicitly. | Threading through 13 call sites | `planCommit`, `simulateExtra`, `compareStrategies` and `planReconcile` all call `project(debt…)`, so they inherit the tables. |
| AD7 | `usuryNotice` resolves its cap through **`capOn`**, like the mora engine. A carried-forward cap still produces the warning, with `stale: true` and `lastValidTo`. No cap at all (`capOn` → `null`) still returns `null`. | Exact-window lookup only (no warning once the month ends) | The modified `interest-rate-conversion` requirement ("Stale cap" scenario) asks for it. One lookup gives the wizard, Nia and mora the same cap. |
| AD8 | `previewChange` lives in the core and replays `project` with and without a synthetic candidate. `snapshot` is extracted from `src/prepay/simulate.js` into `src/ledger/snapshot.js`. | A UI-only diff | The same numbers serve the web and Nia, and the core reuses one replay. |
| AD9 | **Mora is accrued inside `projectLoan`, per row.** `accrueLate(state, to)` runs before each event and once at `asOf`. Each row keeps an exact accumulator and is rounded once (`roundUnit(exact, unit)`). Outstanding = rounded − paid. | An overlay after projection; synthetic events; per-segment rounding | The existing `payRows`, `allocate` order (charges → taxes → lateInterest → interest → principal), `costOf`, `pastDue` and `dueNow` work unchanged. Single rounding is path-independent. |
| AD10 | Daily rate = `Math.expm1(Math.log1p(EA/100) / 365)`. Each segment accrues `base × daily × days`. | `Math.pow(1+EA,1/365)-1` | Better precision near 0, and Node16-safe. Golden: 28.59 % → 0.00068917. |
| AD11 | Days are counted as a clock: day *t* accrues when `t > max(dueOn + graceDays, lateSince)` and `t ≤ to`. Payments and policies take effect at the end of their date. | Counting from the due date inclusive | The day-10 payment gets exactly 10 days (1,375). A `late_policy` dated today accrues from tomorrow. |
| AD12 | `late_policy {late}` is a new event kind. `terms.late` and `terms.modality` live inside `termsJson`. `waiveLate` is added to the restructure payload. | Editing `termsJson`; new columns | Replayable and voidable, and no schema change. Older `validateTerms` already drops unknown keys. |
| AD13 | Restructure terms are built by core `buildRestructureTerms(current, {effectiveOn, carriedMinor, overrides})`. `principalMinor` is informational: `applyRestructure` recomputes the carried balance at replay. | Separate web and Nia builders | Nia rebuilds terms at Confirm from the live debt (AD14), and a backdated event cannot desynchronize. |
| AD14 | A Nia plan-change pending stores **overrides only**. At Confirm, the terms (restructure) or charges (charge change) are rebuilt from the **live** debt and written; the reply states the written figures (carried balance, new installment). If the rebuilt terms are invalid, the event would be unreadable, or the payload exceeds 8000 characters, Nia writes nothing and explains. | Storing the full terms; re-previewing when the debt changed | Keeps the pending within 1.5 KB, and follows the spec scenario "Debt changed before Confirm": the written carried balance reflects a payment made after the preview. |
| AD15 | A backdated change made from Nia gets a note; `planReconcile` does not move into the core yet. | Moving reconcile into the core now (about 150 lines) | Owner assumption Q2. Web reconcile on open repairs the cost rows. |
| AD16 | Reconcile runs after every plan-change or void save, through `useCommitDialog({ afterSave })`. `reconcileCosts` reads **fresh** events (`listDebtEvents(debtId)`). | Reading hook state, which is stale right after `reload()` | `current.current` updates only on render, so a read straight after `reload()` can miss the new event. |
| AD17 | No new UI dependency: `MoreActionsMenu` is a small disclosure menu (`aria-haspopup`, Escape and outside click close it). | `@radix-ui/react-dropdown-menu` | Only Radix Dialog is installed. |
| AD18 | `legal-schema.mjs` is a sibling of `debt-schema.mjs`, with `withLegalSchema(tables, team)` chained after `withDebtSchema`. | Editing `DEBT_TABLES` | Keeps the shipped debt-schema tests and shapes untouched. |

## Forward compatibility (A1) and rollback

```
project(debt, events, asOf, opts)
  readEvents(events) ──► { known: normalized[], unknown: [{id, kind}] }
  known ─► filter ≤ asOf ─► activeEvents ─► sortEvents ─► projector
  unknown ─► notices.push({ code:'unknown_event_kind', eventId, kind })
```

| Data present | Bundle before A1 | A1 ≤ bundle < C3 | Bundle ≥ C3 |
|---|---|---|---|
| `rate_change` / `charge_change` / `restructure` | Replays (the core already supports them) | Same | Same |
| `terms.late`, `terms.modality` | Ignored (`validateTerms` drops unknown keys) | Ignored before C2 (kept from C1); honoured from C2 | Honoured |
| `late_policy` event | **The debt is unreadable**, and Nia cannot pay it | Skipped, with a notice and a banner; reconcile is skipped; payments compute their cost without mora (repaired later by the newer bundle's reconcile) | Honoured |
| Restructure `waiveLate` | Stripped | Stripped before C3 | Honoured |
| `legal_rates` rows | Ignored (code tables) | Used from A2 | Used |

Rollback rule: rolling back **before A1** while any `late_policy` exists requires deleting those rows in the Appwrite console. `debt_events` has no team delete permission, so this is an operator task. Rolling back to any build at or after A1 is safe.

## Interfaces / Contracts

### Legal (`src/legal.js`, A1)

```js
LEGAL_MODALITIES = ['consumer','low_amount','productive','productive_rural','productive_urban','popular_rural','popular_urban','mortgage']
usuryFromIbcBp(ibcBp) → usuryBp                              // floor((bp*3+1)/2)
resolveLegal(rows, defaults = { usuryTable: USURY_TABLE, smmlvTable: SMMLV_TABLE })
  → { usuryTable: [{ modality, validFrom, validTo, capEA, source, verified, origin: 'override'|'ibc'|'default', ibcEA? }],
      smmlvTable: [{ year, valueMinor, source, verified, origin }],
      status: 'table'|'defaults'|'unavailable' }   // sorted; unknown kind or modality rows are ignored; mortgage ibc rows never derive a cap
resolveLegal.unavailable(defaults) → defaults with status 'unavailable'   // used by the loaders when legal_rates cannot be read
capOn(usuryTable, modality, date) → { capEA, stale:false, entry } | { capEA, stale:true, lastValidTo, entry } | null
smmlvFor(smmlvTable, year) → { valueMinor, stale } | null
DEFAULT_LEGAL = resolveLegal([]);  legalOf(debt, opts) → opts.legal ?? debt.legal ?? DEFAULT_LEGAL
usuryNotice(rate, modality, asOf, { usuryTable })            // cap via capOn; a carried cap adds stale: true, lastValidTo; no cap → null
ley1555Notice(terms, asOf, { smmlvTable }) → adds thresholdMinor (880 × SMMLV of the openedOn year), aboveThreshold: boolean|null
```

The kind scope of `ley1555Notice` stays as shipped (mortgage) until the spec answers Q1.

Load-time notices (all informational, never blocking):

| Notice | Raised by | When | Shown |
|---|---|---|---|
| `legal_rates_unavailable` | Loaders (A2): `useDebtData.load` and Nia `loadLegal` | `listLegalRates` fails (404 = table missing, or any other error). Debts still load, decorated with `resolveLegal.unavailable(...)`. | Web: a banner on the debts list and the detail ("No pudimos leer las tasas legales del hogar; usamos los valores de la app."), plus the Ajustes banner. Nia: one line appended to previews that cite a cap. |
| `late_mortgage_unverified` | `project()` (C2) | `modalityOf(terms) === 'mortgage'` and the late mode in force is not `none` | Detail notices and Nia mora preview ("Reglas de la Ley 546 no aplicadas"). |

### Plan changes (B1, C3)

```js
previewChange(debt, events, draft, { on }) → {
  before: Snapshot, after: Snapshot, backdated: boolean, payloadChars: number,
  impacted: [{ eventId, kind, effectiveOn, costBeforeMinor, costAfterMinor }],  // active events whose cost changes
  notices }                                                                       // throws ValidationError (installment_too_low…)
Snapshot = { balanceMinor, pastDueMinor, lateInterestMinor, installmentMinor, nextDueOn, remainingPeriods, lastDueOn, remainingCostMinor }
removeCharge(charges, id) → charges without id and its pctOfCharge dependents (transitively)
restructureCarry(debt, events, on) → { balanceMinor, arrears: { interest, charges, taxes, lateInterest }, carriedMinor, waivableLateMinor }
buildRestructureTerms(current, { effectiveOn, carriedMinor, overrides }) → validated DebtTerms   // keeps current.late unless overridden; firstDueOn must be > effectiveOn
```

### Mora (C1–C3)

```js
terms.late = { mode: 'none'|'usury'|'fixed'|'contract_multiple', rate?: Rate /*fixed*/, multiple?: 0<m≤3, graceDays: 0..90 /*default 0*/ }
terms.modality?: LEGAL_MODALITIES item   // default: kind 'mortgage' → 'mortgage', otherwise 'consumer'
late_policy event: amountMinor 0, payload { late }  // validated by normalizeLate
```

| Mode | Annual rate used on day *t* | No cap known |
|---|---|---|
| `none` (or `late` absent) | 0. Bank-stated `bankSplit.lateInterest` still counts as paid. | — |
| `usury` | `cap(t)` | Contract EA, plus `late_cap_unknown` |
| `fixed` | `min(EA(rate), cap(t))` | `EA(rate)`, plus `late_cap_unknown` |
| `contract_multiple` | `min(m × contractEA(t), cap(t))` (offered in "Configurar mora" and Nia; not in the wizard) | `m × contractEA`, plus `late_cap_unknown` |

When the date is past the last cap, the latest cap carries forward with one `late_cap_stale {modality, lastValidTo}` notice.

**Mora replaces regular interest (corriente) on overdue principal (owner decision 3).** A schedule row bills interest only for its own period. Once the row's due date passes, its unpaid principal earns no further corriente, because no later row charges interest on it (the next rows amortize the scheduled balance). From the day after the due date (plus `graceDays`), that principal earns only mora. The two are never charged for the same days. Cards follow the same rule (F3).

`accrueLate(state, to, ctx)` (`src/late/accrue.js`) works in five steps:

1. The window `(state.lateClock, to]` is split at the cap `validFrom` boundaries. The contract rate and the policy only change at events, and accrual already stops at each event.
2. Each row's base is `max(row.principalMinor, 0) − row.paid.principal`. Settled and capitalizing rows therefore have a base of 0, and interest, charges and taxes never accrue mora.
3. For each segment and row: `row.late.exact += base × daily(EA_seg) × days`, and `row.late.days += days` when `base > 0 && EA_seg > 0`.
4. `state.lateClock = to`.
5. Row integration (`rows.js`):
   - `lateMinor(row) = roundUnit(row.late.exact, unit)`;
   - `rowDue().lateInterest = lateMinor − paid.lateInterest`;
   - `rowOutstanding` adds `lateMinor`.

Projection additions:

- `lateInterestMinor`, which equals `totals.remainingLateInterest`;
- per plan row: `lateMinor`, `lateDays`, `lateBaseMinor`;
- notices: `late_cap_stale` and `late_cap_unknown`.

Restructure: `rowOutstanding` already includes mora, so the arrears are capitalized. With `waiveLate`, `rowDue(row).lateInterest` is subtracted from the carried balance, and `applied[].waivedLateMinor` records the waived amount.

Verified numbers (AD10, AD11):

| Case | Daily rate | Exact | Result |
|---|---|---|---|
| 28.59 % EA | 0.00068917 | — | — |
| 199,505 × 10 days | — | 1,374.92 | **1,375** |
| 199,505 × 30 days | — | 4,124.76 | **4,125** |
| Pay 390,381 on day 10 | — | — | charges 10,000 · mora 1,375 · interest 180,876 · principal 198,130; cost **192,251** |
| Pay 300,000 on day 10, then 10 more days | — | 2,007.27 cumulative | outstanding **632** |
| Mid-way cap: 5 days at 28.59 %, then 5 at 27.50 % (illustrative) | — | 687.46 + 664.18 = 1,351.64 | **1,352** |
| Card: 125,000 × 10 days | — | 861.46 | **861** |

### Card mora (F3)

1. **Base.** At each due date, the unmet part of the minimum is split. Because payments go to non-principal first, the unmet principal is `min(shortfall, principal part of the minimum)`. Interest, fees and taxes of the minimum never accrue mora.
2. **Window.** The unmet principal accrues mora daily (same primitives, cap, daily rate and day count as loans). Accrual starts the day after `dueOn + graceDays` and stops at the **earliest** of: a later payment covering it, the **next statement close**, or `asOf`.
3. **Replaces revolving interest.** Over those days, the unmet principal is excluded from the revolving interest base, so it never earns both.
4. **Billing.** At the next statement close, the bill is `round(exactTotal) − billedSoFar`. It goes on a `lateInterest` line in the statement total and the contractual minimum, and into `accrued.lateInterest`. A billed mora line is outside `interestBase` and the revolving balance, so it accrues no further interest or mora.
5. **Statement override.** `adjustment` gains an optional `lateInterestMinor`, entered in `StatementDialog`. It overrides the billed mora of the latest closed cycle, and the balance difference goes to that line, not to the revolving balance. Example: computed 861, statement 900, drift +39, projection 900. Older cores drop the unknown field (the `adjustment()` normalizer keeps known keys only).
6. **Restructure on a card is a typed error.** `planCommit` and `previewChange` throw `ValidationError('restructure_unsupported')` when the terms kind is `card`. A stored card `restructure` (which cannot be created from the UI) is no longer silently ignored by `projectCard`; it is skipped with a `card_restructure_ignored` notice.

### Appwrite schema: `legal_rates` (A2, additive, create-only)

| Column | Type | Required |
|---|---|---|
| `householdId` | s36 | yes |
| `kind` | s16 (`ibc`, `usury`, `smmlv`) | yes |
| `modality` | s24 (`all` for `smmlv`) | yes |
| `validFrom` | s10 | yes |
| `validTo` | s10 | yes |
| `value` | integer | yes |
| `source` | s200 | no |
| `verified` | boolean | no |
| `actorId` | s36 | yes |

| Indexes | Permissions |
|---|---|
| **unique** `by_household_kind_modality_from` [householdId, kind, modality, validFrom]; key `by_household` [householdId] | Table: team read, create, update. Row: team read and update. No delete. |

- Months run from the first to the last day of the month. SMMLV rows run from `YYYY-01-01` to `YYYY-12-31`.
- Range guards (core and UI):
  - `ibc` and `usury`: 500..10000 bp.
  - `smmlv`: 100,000..100,000,000.
- **Sizes are immutable** once created. Operator: run `npm run migrate:appwrite` (twice on dev first) **before** deploying A2 or later.
- If the table is missing: the web reads a `404`, uses `DEFAULT_LEGAL`, and sets `legalStatus: 'missing'`. Ajustes then shows "Falta actualizar la base de datos". Nia falls back to the defaults silently.

## Data Flow

```
legal_rates ─list─► resolveLegal ─► legal ─┬─► debts.map(d => ({...d, legal}))  (useDebtData / Nia loadDebts)
                                           └─► DebtWizard / RateField / previewCreate ({usuryTable})
debt(+legal) + events ─► project ─► accrueLate per event ─► rows/allocation/cost ─► views, planCommit, reconcile
Dialog ─previewChange─► before/after ─submit─► planCommit/commitPlan ─► reload ─► afterSave: reconcileCosts(fresh events)
Nia: extract ─► pending{overrides} ─► Confirm: rebuild from live debt ─► valid? commit + report written figures : explain, write nothing
```

## Web and Nia behaviour

| Topic | Design |
|---|---|
| "Más acciones" | `MoreActionsMenu` in `DebtDetail`. Loans: Cambiar tasa, Cambiar seguros y cargos, Configurar mora (D2), Reestructurar. Cards: Cambiar tasa, Cambiar seguros y cargos, and Configurar mora (wired in F3, with the card mora engine); never Reestructurar. |
| Configurar mora (`LatePolicyDialog`) | Modes: `none`, `usury`, `fixed` (`RateField`), `contract_multiple` (multiple input, 0 < m ≤ 3). Optional `graceDays` and an effective date (default today, warning when in the past). The live preview uses `previewChange` with the `late_policy` draft `on: today`: mora as of today before and after (`lateInterestMinor`), the cap in force and the capped EA. When the legal table does not cover today, it shows the `late_cap_stale` notice from `after.notices`. Writes one `late_policy` through the commit flow; then `afterSave` reconcile. |
| RateChangeDialog | Effective date (warning when in the past), `RateField` with the EA echo and the usury notice, then keep term or keep installment (`keep_installment` only for French loans), then the live `previewChange`. On `installment_too_low`: *"Con la nueva tasa, la cuota actual ya no cubre los intereses o el plan pasaría de 2000 cuotas. Elegimos «Mantener el plazo» para recalcular la cuota."*, and `keep_term` is pre-selected. |
| ChargesEditor and ChargeChangeDialog | The editor works on real `Charge[]`: kind, label, basis (fixed, % saldo, % original, % de otro cargo with an earlier-charge select, % subtotal), and cadence. It keeps `fromPeriod`/`toPeriod`. Removing a charge uses `removeCharge` and lists the dependents it removes. Validation goes through the core `normalizeCharges` (exported in B1). |
| RestructureDialog (3 steps) | 1) `restructureCarry` breakdown. 2) New terms from `fromTerms(projection.terms)`: rate, system, periodicity, n, `firstDueOn` > effective date, grace or balloon, ChargesEditor, "Condonar intereses de mora". 3) Before and after, the usury notice, and a `payloadChars ≤ 8000` check. |
| Void rules (`voidRuleOf`) | Can be voided: payment, extra_payment, charge, adjustment, rate_change, charge_change, late_policy. Restructure: **guarded**. It needs a confirmation checkbox, and it is blocked when any active `payment`, `extra_payment`, `rate_change`, `charge_change`, `late_policy` or `restructure` sorts after it. The rule returns `voidBlocked: { code: 'later_events', events: [{ id, kind, effectiveOn }] }`, and the UI names them ("No se puede anular: la bloquean el pago del 5 nov y el cambio de tasa del 1 dic"), writing nothing. Disbursement and void cannot be voided. Success messages depend on the kind. |
| History summaries (`eventSummary`) | `Tasa: 24,00 % → 20,00 % E.A. desde 1 nov · mantiene plazo` (old and new EA come from `applied[]`: `applyRateChange` returns `{ fromEA, toEA }`); `Cargos: seguro de vida, cuota de manejo (+1)`; `Reestructuración: $ 9.812.000 a 36 cuotas`; `Mora: tasa de usura desde 13 oct` |
| Ajustes | Navigation: `Sidebar` (button enabled, `aria-current`), `MoreSheet` item, `FinanceShell` lazy `SettingsContainer` with `case 'Ajustes'`, added to `UNSCOPED_VIEWS`. The `LegalRatesPanel` table by modality and month shows the badges *Derivada del IBC*, *Usura manual*, *Valor de la app*, *Sin verificar* and *Desactualizada: usando la de {mes}*. The form has a month picker, a modality select, an IBC-or-usury toggle, the derived echo "Usura = 29,24 % E.A.", and a "Verificado" checkbox. SMMLV is entered by year. The panel says: "Informativo: el extracto del banco manda". |
| Mora UI (D2) | The wizard adds a mora select to the Plan step with defaults by kind: consumer, vehicle, libranza, leasing and mortgage default to `usury`; family, informal and other default to `none`; `fixed` uses `RateField`. The detail shows a mora KPI, a Mora column when any `lateMinor > 0`, and the `late_cap_stale`, `late_cap_unknown` and `late_mortgage_unverified` notices (stale with a link to Ajustes). The payment preview shows a mora line. "Configurar mora" opens the `LatePolicyDialog`. |
| Nia actions | New actions: `legal_rate`, `rate_change`, `charge_change` (edit or remove only), `restructure`, `late_policy`. New extraction fields: `planChange{effectiveOn, mode, chargeRef, op, newValue, n, system, periodicity, firstDueOn, waiveLate}`, `legal{kind, modality, month, year, value}`, `late{mode, rate, multiple, graceDays, effectiveOn}`. The mora preview shows the mode (all four, including `contract_multiple`), the effective date (default today), the cap in force, the capped EA when the requested rate is above it, and "la mora no es retroactiva". |
| Nia callbacks | `nia:mode:keep_term` and `nia:mode:keep_installment` (25 bytes or less). `nia:conv:*` now goes to `CONVENTION_NEXT[pending.action]`: create, rate_change or restructure. |
| Nia `legal_rate` | When the user names a month without a year, the code picks the year that puts that month within ±6 months of today. Confirm uses `upsertLegal`: create, and on `409` call `deps.updateRow`. The new seam in `index.js` is a `PATCH /rows/{id}`. |
| Nia exactly-once | Event id `de{id}`, dedupe key `debt:{id}`, and the done marker that answers "ya estaba registrado". A legal-rate save is idempotent by its row id. |
| Nia backdated note | When `impacted.length > 0`, the reply adds: "Los costos de pagos anteriores se actualizarán cuando abras la deuda en la web." |

## File map by slice

Each slice stays within 2,000 lines, and each PR within 800. Estimates include tests. Past batches ran up to 2× over forecast, so every slice above 650 lines has an `a`/`b` valve.

| Slice | Files (C = create, M = modify) | Est. lines | Valve |
|---|---|---|---|
| A1 core: compatibility and legal | M `src/ledger/events.js` (`readEvents`), `src/ledger/project.js` (notice, `legal` in context), `src/legal.js` (resolve, cap, SMMLV, `legalOf`, Ley 1555), `index.js`, `test/node16.test.js`; C `test/ledger/events.forward.test.js`, `test/legal.resolve.test.js` | 640 | — |
| A2 schema and decoration | C `scripts/lib/legal-schema.mjs` + test; M `scripts/migrate-appwrite.mjs`, `src/appwrite.js` (`TABLES.legalRates`, `listLegalRates`, `upsertLegalRate`) + test, `useDebtData.js` (`legal`, `legalStatus`, decorate), `reconcile.js` (skip unknown), `DebtsView`/`DebtsContainer`/`DebtDetail` (wizard opts, unknown banner, `legal_rates_unavailable` banner), `wizardModel.js`, Nia `handler.js` (`loadDebts` + `loadLegal` with `unavailable` fallback), `preview.js`, `docs/setup.md` | 800 | A2a schema and web; A2b Nia |
| A3 Ajustes | C `src/features/settings/{SettingsContainer,SettingsView,LegalRatesPanel}.jsx`, `legalRatesModel.js`, `useLegalRates.js` + tests; M `Sidebar.jsx`, `MoreSheet.jsx`, `FinanceShell.jsx` + shell tests | 900 | A3a navigation, model and hook; A3b panel |
| B1 preview and voids | C core `src/ledger/{snapshot,preview}.js`, test `preview.test.js`; M `src/prepay/simulate.js` (uses snapshot), `src/charges.js` (`removeCharge`), `src/ledger/tail.js` (`applyRateChange` returns `{ fromEA, toEA }`), barrel (`previewChange`, `removeCharge`, `normalizeCharges`); web C `eventSummary.js`; M `debtDetailModel.js` (`voidRuleOf` with blocking events, summary), `EventHistory.jsx`, `VoidDialog.jsx` (guarded variant naming the blockers) + tests | 820 | B1a core; B1b web |
| B2 rate change | C `MoreActionsMenu.jsx`, `rateChangeModel.js`, `RateChangeDialog.jsx` + tests; M `DebtDetail.jsx`, `DebtDetailContainer.jsx`, `useCommitDialog.js` (`afterSave`), `useDebtData.js` (fresh events) | 750 | B2a menu, `rateChangeModel`, `afterSave` and fresh-events reconcile; B2b dialog and container wiring |
| B3 charge change | C `ChargesEditor.jsx`, `chargesEditorModel.js`, `ChargeChangeDialog.jsx` + tests; M container | 700 | B3a `ChargesEditor` and its model; B3b dialog and container wiring |
| C1 late terms | C core `src/late/policy.js` (`LATE_MODES`, `normalizeLate`, `modalityOf`, `defaultLateFor`, `dailyRate`, `lateEAOn`); M `terms.js` (`late`, `modality`), barrel + tests | 520 | — |
| C2 accrual | C `src/late/accrue.js`, `test/late/accrue.test.js`, fixture `late-28.59-golden.json`, `test/late/properties.test.js`; M `ledger/rows.js` (late fields, `rowDue`, `rowOutstanding`, `decorate`), `ledger/project.js` (clock, calls, fields, `legalOf`, `late_mortgage_unverified`) | 900 | C2a engine and rows; C2b project fields, notices, goldens and properties |
| C3 policy and restructure | M `events.js` (`late_policy`, restructure `waiveLate`), `project.js` handler, `tail.js` (`applyRestructure` waive); C `src/ledger/restructure.js` (`restructureCarry`, `buildRestructureTerms`) + tests; barrel | 640 | — |
| D1 restructure UI | C `wizard/fromTerms.js`, `restructureModel.js`, `RestructureDialog.jsx` + tests; M container and menu | 1,050 | D1a model and `fromTerms`; D1b dialog |
| D2 mora UI | M `wizardModel.js`, `PlanStep.jsx`, `DebtDetail.jsx` (mora notices), `PlanTable.jsx`, `paymentModel.js`, `PaymentDialog.jsx`, `eventSummary.js`, `MoreActionsMenu.jsx` ("Configurar mora" for loans); C `LatePolicyDialog.jsx` (four modes, `graceDays`, date, preview as of today, stale notice) + tests | 850 | D2a wizard; D2b detail, payment and `LatePolicyDialog` |
| E1 Nia `legal_rate` | C `functions/nia/debt/legal.js` + test; M `extract.js`, `handler.js`, `pending.js`, `index.js` (`debtUpdateRow` seam; `DEBT_ROW_ACTIONS.legal_rates = ['read','update']`) + wiring test | 700 | E1a `legal.js` and extraction (month resolution, range guard, preview); E1b handler, pending, `updateRow` seam and wiring |
| E2 Nia rate and charge | C `functions/nia/debt/planChange.js` + test; M `extract.js`, `pending.js` (`modeKeyboard`, `parseCallback`), `handler.js` (`CONVENTION_NEXT`, rebuild-at-Confirm, backdated note), `preview.js` + tests | 1,000 | E2a rate, mode and convention; E2b charge and note |
| F1 Nia restructure | M `planChange.js` (rebuild terms from the live debt at Confirm), `handler.js`, `extract.js` + tests | 650 | — |
| F2 Nia mora | M `extract.js` (`late{mode, rate, multiple, graceDays, effectiveOn}`), `handler.js` (`late_policy` action, create default by kind), `preview.js` (mora line, cap in force, capped EA), `replies.js` (list mora) + tests | 450 | — |
| F3 card mora | M `card/card.js` (`late_policy` handler, unmet-principal accrual stopping at the next close, revolving-base exclusion, billing, `card_restructure_ignored`), `ledger/events.js` (`adjustment.lateInterestMinor`), `ledger/commit.js` + `ledger/preview.js` (`restructure_unsupported` for cards), `cardWizardModel`/`CardStep` default, `CardDialogs.jsx` (stated mora field), `CardPanel` line, `MoreActionsMenu.jsx` + `LatePolicyDialog.jsx` (card variant) + tests | 950 | F3a engine and core guards; F3b card UI and "Configurar mora" for cards |

The node16 source list and the barrel exact-keys test change **RED-first** in every core slice.

## Testing Strategy (strict TDD)

| Slice | RED-first tests | Approach |
|---|---|---|
| A1 | An unknown kind is skipped with a notice; `validateEvent` and `planCommit` still throw; a void of an unknown target has no effect; 1949 → 2924 and 1906 → 2859; override wins; a mortgage IBC row derives no cap; empty rows give the code defaults; `capOn` covers, carries stale, and returns `null` before the first entry; `usuryNotice` with only the 2026-10 cap on 2026-12 warns with `stale: true`; `smmlvFor` carries forward; Ley 1555 threshold above and below | Pure unit; mutation: lenient `validateEvent` must fail |
| A2 | Schema snapshot (types, sizes, unique index, no delete), merge refuses collisions; `upsertLegalRate` turns a `409` into an update; legal read failure or `404` gives defaults plus the `legal_rates_unavailable` banner on the list and the detail while debts still load; reconcile skips unknown; Nia `loadDebts` decorates and survives a `404` | Unit + `vi.mock('appwrite')`; Nia fake fetch |
| A3 | Navigation reaches Ajustes; grouping and badges; derived echo; range errors; save, then reload; missing-table banner | RTL + user-event |
| B1 | `previewChange` before and after for a rate change (cross-check with `project`), keep installment versus keep term, `impacted` for a backdated change, `payloadChars`; `removeCharge` with transitive dependents; `voidRuleOf` table including the guarded restructure, blocked by each later kind (payment, extra payment, rate change, charge change, mora policy, restructure) with the blockers named; the rate-change summary shows old and new EA and the date | Unit + RTL |
| B2/B3 | Preview shown before saving; `installment_too_low` pre-selects keep term; one event on a double submit; `afterSave` reconcile toast; the editor rejects a `pctOfCharge` without an earlier reference | RTL with a mocked port |
| C1 | Validation per mode, defaults by kind, `dailyRate(28.59)` = 0.00068917 (1e-8) | Unit |
| C2 | Goldens: 1,375 / 4,125; the 390,381 split and cost 192,251; 300,000 then 632; mid-way cap **1,352**; `none` gives 0; existing debts without `late` reproduce the S3a fixtures (parity). Properties over 200 seeded loans: monotonic in `asOf`; exact ≤ base·daily(cap)·days; 0 for `none` and for 0 % fixed; unpaid interest only gives 0; path independence (an inserted no-op split changes exact by less than 1e-6) | Unit + seeded `mulberry32` |
| C3 | `late_policy` accrues only after its date; void restores; restructure capitalizes mora; `waiveLate` subtracts and records it; `buildRestructureTerms` rejects `firstDueOn` ≤ effective date | Unit |
| D–F | Wizard defaults by kind; mora KPI and column; `late_mortgage_unverified` shown; "Configurar mora": effective 10 days ago gives 1,375, effective today gives 0, stale notice, `contract_multiple` input; pending ≤ 1.5 KB and callback ≤ 64 B; a payment between preview and Confirm makes the written carried balance reflect it; invalid rebuilt terms write nothing; double Confirm writes once; `nia:mode` and generalized `nia:conv`; legal-rate month resolution; Nia mora preview with the capped EA; card golden 861 billed at the next statement, no accrual after the close, no revolving interest on the unmet principal, statement override 900, card `restructure` rejected with a typed error | RTL / Nia fakes / unit |

Node16: no `Object.hasOwn`, array `.at(`, `findLast`, `toSorted`, `structuredClone` or `groupBy` (scan in `test/node16.test.js` and the Nia packaging scan). Every core test file carries `// @vitest-environment node`.

## Threat Matrix

N/A. There is no routing, shell, subprocess, VCS/PR automation, executable-file classification or process-integration boundary. The only new outbound call is the Nia `PATCH` row seam, which uses the existing `appwriteRequest`.

## Migration / Rollout

1. **Before deploying A2:** run `npm run migrate:appwrite`. It creates `legal_rates` and is additive and idempotent.
2. **A1 compatibility on both runtimes first:** deploy a web build and a Nia tarball that are both at or after A1, *before* any build at or after D2 (web) or F2 (Nia), because those can write `late_policy`.
3. **Deploy together:** from C2 on, always deploy the web build and the Nia tarball together (`npm run package:nia`). Both runtimes must use the same mora engine, or reconcile will flip cost rows.
4. **Rollback:** see the compatibility matrix. The table may stay. Rolling back before A1 requires deleting the `late_policy` rows.

## Open Questions

- [ ] Ley 1555: kind scope and the 880 SMMLV threshold (owner Q1). The mechanics are designed; the scope stays as shipped.
- [ ] Mortgage `usury` has no code-default cap, so it falls back to the contract EA with `late_cap_unknown` until the household enters a mortgage cap.
- [ ] Editing a past month in `legal_rates` changes past mora costs. Reconcile rewrites those cost rows on the next opening of each debt (with a toast).
- [ ] Nia defaults for mora at creation arrive in F2. Between D2 and F2, debts created from Nia have no `terms.late`.
