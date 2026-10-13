# Design: Debt Management (cards and loans, web + Nia)

A pure, dependency-free core (`packages/finance-core/`) turns `debts` + append-only `debt_events` into plans, payment splits, simulations and advice. The web app and Nia call the same core. Every payment writes one event plus one cost-only expense row, made exactly-once by a unique `dedupeKey` and a deterministic cost-row ID. Nia moves into the repo and ships as a tarball built by Vite SSR plus an in-process tar writer.

> Size note: this design covers ten areas requested by the orchestrator. It exceeds the 800-word skill budget on purpose. Tables carry most of the detail.

## Quick path (review order)

1. Architecture decisions (AD table).
2. Core API and data shapes (Interfaces).
3. Schema and write path (Appwrite impact).
4. Slices S0–S9 with line estimates.

## Architecture Decisions

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| AD1 | The ledger uses approach (b). `project(debt, events, asOf)` computes everything, and no cache is kept. | (a) stored schedule rows; (c) a cache | One source of truth. No lost updates. The same code runs on web and Nia. |
| AD2 | The core lives in `packages/finance-core/` as plain ESM with no dependencies and Node16-safe APIs. | Shared code under `functions/`; `package.json` `imports` | `.dockerignore` excludes `functions`. `imports` cannot point outside Nia's package. |
| AD3 | The web imports the core through a Vite alias `@finance-core` (in `vite.config.js`, which Vitest inherits). Nia imports it by relative path `../../../packages/finance-core/index.js`. | Alias everywhere; relative everywhere | The packaging build runs with `configFile:false` and needs no alias. The alias keeps deep web imports readable. |
| AD4 | Dates are `YYYY-MM-DD` strings, with arithmetic through `Date.UTC` only. Amounts are integer pesos. Rates are numbers in percent units, as the bank states them. | `Date` objects; minor units in cents | No time-zone drift. COP has no cents in practice. Keeping the stated value lets Nia and the UI echo it exactly. |
| AD5 | Rounding: each component of a period (interest, each charge, installment) is rounded half away from zero to `terms.roundingUnit` (default 1). The residual goes to the last installment, so the final balance is exactly 0. | Round only at the end; banker's rounding | This matches bank statements to the peso. `adjustment` events absorb any remaining drift. |
| AD6 | Exactly-once writes use a unique index on `debt_events.dedupeKey` and a deterministic cost-row ID `dc{eventId}`. A `409` means "already done". Transactions API: adopted only if the S4 spike passes, and only as an optional wrapper around the same calls. | Transactions API as a hard requirement; a unique index on `transactions.dedupeKey` | Availability on self-hosted 1.8.1 is unverified. Existing transaction rows may hold duplicate `dedupeKey` values, so a unique index on that table could fail to build. |
| AD7 | Void = a `void` event (`dedupeKey void:{targetId}`) plus **deleting** the cost row, not flagging it. Cost rows carry team read/update/delete permissions. | Status flag on the row (for example `status:'voided'`); per-user delete only | This is a deliberate deviation from flagging. No aggregation in `src/` filters on `status` (`FinanceShell` totals, `aggregateMonthlyTotals`, `buildCashflowSeries`, CSV export, Nia snapshot), so a flagged row would still be counted. The spec's "voided" wording is met by the immutable `void` event (actor, reason, target) as the audit trail plus the removal of the row. Either member may void (Assumption 5). |
| AD8 | Reconcile on read: when a debt detail opens, the expected cost per active payment (from `project`) is diffed against the rows where `transactions.debtId` matches. The diff creates, updates or deletes rows, and a toast reports it. | Background job; stored `costMinor` | Repairs a partial dual write and the effect of backdated events without new infrastructure. |
| AD9 | Debt data loads in a separate `useDebtData` hook when the Deudas view mounts. | Adding it to `getWorkspace()` | Keeps the initial load and the other views unchanged. |
| AD10 | Nia: the main prompt gains `intent:"debt"`. A second, specialized Gemini call extracts the debt fields. All logic lives in pure modules under `functions/nia/debt/`. | One giant prompt; logic inside `index.js` | Smaller schemas extract better. Pure modules can be tested without `undici` or env. |
| AD11 | Gemini only paraphrases `facts`. A numeric guard and a deterministic template are the fallback. | Letting Gemini compute | Money math must be deterministic (current `analysis` flaw). |
| AD12 | Packaging: Vite 8 `build({ configFile:false, build:{ ssr, target:'node16' } })` produces `dist-nia/`. An in-process ustar writer plus `zlib.gzip` then produces `functions/nia.tar.gz`. | Spawning the system `tar`; vendoring; rolldown CLI | Vite 8.3.4's types confirm `build.ssr`, `build.rolldownOptions`, an esbuild-style `target` and `ssr.external`. The in-process tar avoids a subprocess and behaves the same on Windows and Linux. |
| AD13 | A `charge` event (card purchase or advance that opens a tranche) and `charge_change` (installment charge definitions) are separate event kinds. | One overloaded kind | They have different payloads and accounting. Neither creates an expense row (purchases are expensed when made). |
| AD14 | `charge.display: 'itemized' \| 'bundled'` affects presentation only. Allocation is identical. | Separate billing flows | This answers question 1 of the proposal: both bank formats are supported without branching the math. |

## Interfaces / Contracts

### Core layout (`packages/finance-core/`)

| File | Exports |
|---|---|
| `index.js` | Barrel re-export (public API only) |
| `src/money.js` | `roundUnit(x, unit=1)`, `sumMinor(list)`, `assertMinor(n)` |
| `src/calendar.js` | `isIsoDate`, `addDays`, `addMonthsClamped(date, n, anchorDay)`, `periodDates(first, periodicity, count)`, `daysBetween`, `compareIso` |
| `src/rates.js` | `CONVENTIONS` (EA, NAMV, MV, NATV, NATA, NAMA, ZERO), `normalizeRate(input)`, `periodicRate(rate, periodicity)`, `toEffectiveAnnual(rate)`, `convertRate(rate, target)`, `rateLabel(rate)` → `"2.1% MV ≈ 28.32% EA"` |
| `src/legal.js` | `USURY_TABLE` (manual: `{modality, validFrom, validTo, capEA}`), `SMMLV_TABLE`, `usuryNotice(rate, modality, asOf)`, `ley1555Notice(debt, asOf)`. Both return info notices and never block. |
| `src/terms.js` | `TERMS_SCHEMA_VERSION=1`, `validateTerms`, `serializeTerms` (throws `TermsTooLarge` over 8000 chars), `parseTerms` (migrates by `schemaVersion`) |
| `src/schedule/index.js` + `french.js`, `german.js`, `bullet.js`, `interestOnly.js`, `manual.js`, `grace.js` | `buildSchedule(terms, {fromPeriod, balanceMinor, startDate})` → `ScheduleRow[]` |
| `src/charges.js` | `evaluateCharges(charges, ctx)`. Order: `fixed`/`pctOutstanding`/`pctOriginal`/`pctOfBase`, then `pctOfCharge` (by `refId`), then `pctOfSubtotal` (GMF) |
| `src/ledger/events.js` | `EVENT_KINDS`, `validateEvent`, `activeEvents` (drops voided events and void events), `sortEvents` (effectiveOn, then $createdAt) |
| `src/ledger/allocate.js` | `allocate(amountMinor, due, order)` → `{charges, taxes, lateInterest, interest, principal, surplus}` |
| `src/ledger/project.js` | `project(debt, events, asOf, opts)` → `Projection`, with a per-kind projector registry (`registerProjector('card', projectCard)`) |
| `src/ledger/commit.js` | `planCommit(debt, events, draft, ctx)` → `{event, costRow\|null}` (pure); `commitPlan(port, plan)` (async, idempotent) |
| `src/card/card.js` (S7) | `projectCard`, `minimumPayment(rule, cycle)`, `cycleDates(statementDay, dueDay, month)` |
| `src/prepay/simulate.js`, `compare.js` | `simulateExtra(debt, events, {amountMinor, strategy, on})`, `compareStrategies(...)` → `{reduceTerm, reduceInstallment, advance}` |
| `src/advice/advice.js`, `facts.js` | `ADVICE_DEFAULTS`, `advise(comparison, signals, thresholds)`, `buildFacts(...)` |

Node16 rules: no `findLast`, `toSorted`, `toReversed`, `structuredClone`, `Object.groupBy`, `Array.prototype.at` on arrays from untrusted input, or regex `v` flag. A static test enforces this (`test/node16.test.js`). Vite's `target:'node16'` only lowers syntax, never APIs.

### Data shapes

```js
// Rate as stated by the bank. value is in percent units: 2.1 means 2.1 %.
Rate = { value, basis: 'effective'|'nominal', periodicity: 'annual'|'semiannual'|'quarterly'|'bimonthly'|'monthly', timing: 'arrears'|'advance' }

DebtTerms = { schemaVersion: 1, kind, unit: 'COP', principalMinor, openedOn, rate,
  system: 'french'|'german'|'bullet'|'interest_only'|'manual'|'none',
  periodicity: 'weekly'|'biweekly'|'monthly'|'bimonthly'|'quarterly'|'semiannual'|'annual',
  n, firstDueOn, dueDay?, grace?: { periods, type: 'total'|'principal' }, balloonMinor?,
  manualPlan?: [[dueOn, amountMinor], ...], charges: Charge[], allocationOrder?: string[],
  prepaymentPenaltyPct: 0, roundingUnit: 1, lateRate?: Rate,
  card?: { statementDay, dueDay, limitMinor?, advanceRate?, managementFee?: { amountMinor, cadence: 'monthly' },
           minPayment: { rule: 'pct_balance'|'interest_fees_plus_pct'|'installments_due', pct?, floorMinor? } } }

Tranche = { id, type: 'revolving'|'deferred'|'advance', label, openedOn, principalMinor, rate, n? }  // derived from events

Charge = { id, kind: 'insurance'|'fee'|'tax'|'other', label, basis: 'fixed'|'pctOutstanding'|'pctOriginal'|'pctOfBase'|'pctOfSubtotal'|'pctOfCharge',
  value, baseMinor?, refId?, cadence: 'per_installment'|'annual'|'once', anchorMonth?, fromPeriod: 1, toPeriod: null, display: 'itemized'|'bundled' }

ScheduleRow = { period, dueOn, openingMinor, interestMinor, principalMinor,
  charges: [{ id, kind, label, amountMinor }], chargesMinor /* kind !== 'tax' */, taxesMinor /* kind === 'tax' */,
  installmentMinor /* principal + interest */, totalDueMinor, closingMinor }

PlanRow = ScheduleRow & { status: 'paid'|'partial'|'due'|'pastDue'|'future',
  paidMinor, outstandingMinor, paidByEventIds: string[] }

Projection = { asOf, termsVersion, balanceMinor, pastDueMinor, nextDue: PlanRow|null,
  plan: PlanRow[] /* FULL schedule, period 1..n, rebuilt after each terms-changing event */,
  applied: [{ eventId, kind, effectiveOn, allocation, costMinor }], tranches?: Tranche[],
  totals: { interestPaid, chargesPaid, taxesPaid, principalPaid, remainingInterest, remainingCharges, remainingTaxes },
  notices: Notice[] }
```

**Plan row status.** `project()` returns the full plan, so PlanTable renders `plan` directly and never merges `applied` itself. While walking events, `project()` applies each payment's allocation to the oldest open rows first and fills `paidMinor`, `outstandingMinor` and `paidByEventIds`. It then sets each row's status:

| Status | Condition |
|---|---|
| `paid` | `outstandingMinor === 0` |
| `partial` | `0 < paidMinor < totalDueMinor` and `dueOn ≥ asOf` |
| `pastDue` | `outstandingMinor > 0` and `dueOn < asOf` |
| `due` | The first row with no payment and `dueOn ≥ asOf` |
| `future` | Every later row |

Rows already settled keep their historical figures. Rows after a `rate_change`, `charge_change`, `restructure` or `extra_payment` are recomputed from that point. `pastDueMinor` is the sum of `outstandingMinor` over the `pastDue` rows.

**Taxes are reported separately.** A charge with `kind: 'tax'` (for example IVA or GMF) rolls into `taxesMinor` and `taxesPaid`, not into `chargesMinor`. An allocation exposes `{charges, taxes, lateInterest, interest, principal, surplus}`. The cost row amount stays `charges + taxes + lateInterest + interest`.

### DebtEvent payloads (`payloadJson`)

| kind | `amountMinor` | payload |
|---|---|---|
| `disbursement` | amount | `{}`. Written automatically when a loan is created. |
| `payment` | paid | `{ bankSplit?: { interest, charges, principal } }`. The bank's split, when given, overrides the computed allocation. |
| `extra_payment` | paid | `{ strategy: 'reduce_term'\|'reduce_installment'\|'advance_installments' }` |
| `rate_change` | 0 | `{ rate, mode: 'keep_term'\|'keep_installment' }` |
| `charge_change` | 0 | `{ charges: Charge[] }`. Replaces the charge set from `effectiveOn`. |
| `restructure` | 0 | `{ terms: DebtTerms }`. Increments `termsVersion` and carries the balance forward. |
| `adjustment` | 0 | `{ balanceMinor?, trancheBalances?: {id: minor}, minimumDueMinor?, dueOn?, note }`. Records the statement truth; the difference is recorded as `drift`. |
| `charge` (card) | amount | `{ trancheType, label, n?, rate? }` |
| `void` | 0 | `{ targetEventId, reason }` |

The cost of a payment (`costMinor`) is `charges + taxes + lateInterest + interest` from its allocation. The principal is never an expense.

## Credit card model (S7)

- **Cycle.** `cycleDates` derives the statement date (`statementDay`) and the due date (`dueDay`), both clamped to the end of the month.
- **Tranches.**
  - Revolving: interest is `balance × monthly(rate)` per cycle.
  - Deferred: each tranche amortizes with French over its own `n` at its own rate. At `n=1` it is interest-free when paid in full.
  - Advances: they accrue interest from day one, prorated by days in the first cycle.
- **Management fee.** A monthly charge with `id: 'mgmt_fee'`, `kind: 'fee'`. Taxes on it link through an ordinary charge, for example IVA `{kind:'tax', basis:'pctOfCharge', refId:'mgmt_fee', value:19}`. The wizard's Card step adds this IVA link by default and the user can edit or remove it. The cost row of a card payment therefore includes the fee together with its taxes. Taxes appear separately in the totals.
- **Minimum payment.**
  - It is computed by the configured `minPayment.rule` (default `interest_fees_plus_pct` with `pct` 5, `floorMinor` configurable).
  - The latest statement `adjustment.minimumDueMinor` overrides it for that cycle.
- **Card past due.** For cards, `pastDueMinor` is measured against the minimum payment of each closed cycle (computed, or taken from the statement), not against the full balance.
  - If payments in the cycle up to its due date total at least the minimum, the cycle is not past due. The unpaid remainder stays in the revolving balance and accrues interest.
  - If they total less, `pastDueMinor` grows by `minimum − paid` and the cycle row gets `status: 'pastDue'`. Late interest applies only if `terms.lateRate` is set.
- **v1 balance source.** The balance is driven by statements. An `adjustment` resets the tranche balances. Optional `charge` events add deferred tranches so that their plans appear. Card purchases stay ordinary expense transactions, and no automatic transaction→debt link exists.
- **Allocation.** The default `allocationOrder` for cards is `fees → interest → deferred installments due → advances → revolving`. It is configurable.

## Appwrite schema (migration impact: additive only)

| Table / change | Columns (type, size, required) | Indexes | Permissions |
|---|---|---|---|
| `debts` (new) | householdId s36 R · name s120 R · kind s24 R · ownerScope s16 R · lender s120 · status s16 R (`active\|closed\|archived`) · currency s3 R · principalMinor int R · openedOn s10 R · termsJson s8000 R · termsVersion int R · actorId s36 R | `by_household_status` key [householdId, status] | Table: team read/create/update. Row: team read and update. No delete (archive instead). |
| `debt_events` (new) | householdId s36 R · debtId s36 R · kind s24 R · effectiveOn s10 R · amountMinor int R · payloadJson s8000 · actorId s36 R · source s16 R (`web\|telegram`) · dedupeKey s160 R | `by_household_debt_date` key [householdId, debtId, effectiveOn]; `by_dedupe` **unique** [dedupeKey] | Table: team read/create. Row: team read (append-only, like `ai_events`). |
| `transactions.debtId` (new optional column) | s36, optional | `by_household_debt` key [householdId, debtId] | Unchanged. Cost rows set row-level team read/update/delete. |

- **String sizes are immutable.** The sizes above include headroom. `termsJson` carries `schemaVersion`, and `serializeTerms` rejects anything over 8000. Manual plans use compact tuples (about 120 rows fit).
- **Script change.** `scripts/migrate-appwrite.mjs` appends the two table definitions and the `transactions` column and index. The script stays create-only.
- **Operator step.** Re-run `npm run migrate:appwrite` before deploying S4 or later (documented in `docs/setup.md`).
- **Row size.** Two s8000 columns stay within the per-row budget already used by `ai_events` and `bot_sessions`.

## Write path

```
UI / Nia ── planCommit(debt, events, draft) ──> { event, costRow }
                │ (pure core: allocation → costMinor)
                ▼
commitPlan(port):
  1. createEvent(event)          409 → findEventByDedupe(dedupeKey)
  2. if costMinor > 0: createRow(transactions, id = "dc"+eventId)   409 → ok
  3. ensureCostCategory()        lookup by folded name, else create id "cf"+householdId (409 → re-read)
```

- **Dedupe keys.**
  - Web: `web:{nonce}`. The nonce is generated once per dialog open, so resubmitting the same dialog is idempotent.
  - Nia: `debt:{pendingId}`.
  - Void: `void:{targetEventId}`.
- **Cost row.** Fields: `type:'expense'`, `source:'debt'`, `debtId`, `categoryId`, and `ownerScope` = the debt's `ownerScope`. `merchant` = the debt name. `note` = `Intereses y cargos`. `occurredAt` = `${effectiveOn}T12:00:00` as ISO. `providerRef` and `dedupeKey` = `debt:{eventId}`. `status:'confirmed'`, `confidence:1`.
- **Void.** A `void` event, then `deleteRow(transactions, "dc"+targetId)`. A `404` counts as success. Reconcile then fixes the costs of later events if the allocation shifted.
- **Category.** "Costos financieros" has `kind:'need'`, a palette color, and an existing icon key.
- **Transactions API.** If the S4 spike passes, `commitPlan` wraps steps 1–2 in `createTransaction`/`createOperations` behind `port.atomic`. Otherwise the sequential path stays.

## Web architecture (`src/features/debts/`)

| File | Role |
|---|---|
| `DebtsContainer.jsx` | Container. Uses `useDebtData`. Owns the create, pay, void and simulate handlers that call `planCommit`/`commitPlan`. Each handler keeps a `saveState` of `{status: 'idle'\|'saving'\|'error', error}`. On failure, the dialog stays open with its inputs and its nonce, shows `readableError(error)` and a "Reintentar" button, and a toast reports the failure. A retry reuses the same `dedupeKey`, so it is idempotent. Only after `commitPlan` resolves does it call `reload()` and the shell's `onRefresh` (month KPIs). |
| `useDebtData.js` | Loads `debts` and `debt_events` (`listAllRows`) on mount. Exposes `{debts, events, status: 'loading'\|'ready'\|'error', error, retry, reload}`. On a load failure the view renders an error panel with "Reintentar" (pattern of `PeriodError`) instead of empty or stale totals. Runs `reconcileCosts(debtId)` when a detail opens; a reconcile failure shows a non-blocking notice. |
| `debtViewModel.js` | Pure. Projects each debt, then builds list items and totals (total balance, monthly installments, next due). Applies the `inScope` filter. |
| `DebtsView.jsx`, `DebtCard.jsx` | List with totals (presentational) |
| `wizard/wizardModel.js` | Pure reducer: steps per kind, defaults and validation, `toTerms()` |
| `wizard/DebtWizard.jsx` + `steps/{Kind,Basics,Rate,Plan,Card,Charges,Review}Step.jsx` | Radix Dialog wizard |
| `RateField.jsx` | Value plus convention select, live `rateLabel` echo, usury notice |
| `DebtDetail.jsx`, `PlanTable.jsx`, `EventHistory.jsx` | KPIs, a paginated plan (`shared/lib/paginate`) that renders `projection.plan` with a status chip per row (paid, partial, due, pastDue, future), and the event list with a void action |
| `PaymentDialog.jsx` | Amount and date. The split preview comes from `planCommit`. If the amount exceeds what is due, a strategy radio appears. |
| `PrepaymentSimulator.jsx` | Extra amount. A comparison table (new term, new installment, interest and charges saved). A "Registrar como abono" button. |

**Failure rule:** there are no optimistic updates. Projections, balances, plan rows and totals are recomputed only from events reloaded after a successful `commitPlan`. Previews inside dialogs are labeled "Vista previa". If a write fails, the screen keeps the last confirmed projection and the dialog shows the error, so nothing unsaved is presented as recorded. A partial dual write (event saved, cost row failed) counts as a failed save for the user, and the retry or the reconcile completes it.

Wizard steps by kind:

| Kind | Steps |
|---|---|
| Consumer, vehicle, libranza | Kind → Basics → Rate → Plan (French default; grace) → Charges (presets: seguro vida `pctOutstanding`, GMF `pctOfSubtotal` 0.4, IVA `pctOfCharge` 19) → Review |
| Mortgage | Same, with German/French |
| Leasing | Plan adds `balloonMinor` |
| Family | Rate defaults to ZERO; Plan offers manual or French at 0 |
| Informal | Plan uses `system:'none'` (balance only) |
| Card | Kind → Basics → Rate → Card (days, minimum rule, fee, initial revolving balance, deferred purchases) → Review |

Shell integration:

- `navItems.js` adds `{label:'Deudas', icon: CreditCard}`, so the Sidebar picks it up automatically.
- `MoreSheet.jsx` adds a Deudas item. The tab bar has no free slot, so `MobileTabBar` only forwards `onNavigate`.
- `FinanceShell.jsx` adds a lazy `DebtsContainer` and `case 'Deudas'`, passing `inScope`, `currentOwnerScope`, `user`, `categories` and `onRefresh`. Deudas is not in `PERIOD_VIEWS`.

## Nia (`functions/nia/debt/`)

| Module | Responsibility |
|---|---|
| `extract.js` | `debtPrompt(text, debtNames, history)` and `normaliseDebtExtraction(raw)`. Schema: `{action: create\|pay\|simulate\|advise\|list, debtRef, kind, name, lender, principalMinor, rate:{value, period, compounding, timing, rawText}, n, periodicity, system, firstDueOn, amountMinor, paidOn, strategy, extraMinor, charges[≤6], card:{statementDay, dueDay}, missingFields[]}` |
| `findDebt.js` | `fold(s)` = NFD, strip `\p{M}`, lowercase, collapse spaces. `findDebt(debts, ref)` returns `{match}`, `{candidates}` or `{none}`. Priority: exact name, then contains name or lender, then kind synonyms. A single active debt is the fallback. |
| `pending.js` | Builds and validates the pending payload (at most 1.5 KB, asserted). Keyboards: `nia:pick:{debtId}` (at most 6, one per row, under 64 bytes), `nia:strat:{strategy}`, `nia:conv:{EA\|NAMV\|MV\|NATV\|NATA}`, `nia:simpay` |
| `preview.js` | Pay preview (split, new balance, next installment, plan effect). Create preview (`rateLabel`, usury and Ley 1555 notices) |
| `replies.js` | List, simulate and advise templates. `clampTelegram(text, 4096)`. Simulate shows the next 3–6 rows and a link to the web view. |
| `guard.js` | `numbersIn(text)` normalizes `.` and `,` separators. `guardParaphrase(reply, facts)` returns the reply, or `null` when it contains any number not in `facts` or exceeds 4096 characters. |
| `cashflow.js` | `cashflowSignals(rows, installmentMinor, otherDebts)`: averages over 3 full months of income and expense, margin, installment-to-income ratio, a higher-rate debt (gap of at least `higherRateGapPct`) |
| `handler.js` | `handleDebt(deps, ctx)` and `confirmDebt(deps, pending)`. `deps` = `{listRows, createRow, deleteRow, gemini, sendMessage, now, ids}`, injected so tests can run it. |

Pending payload:

```js
{ kind:'debt', v:1, id:'<pendingId>', action:'create'|'pay', awaiting:'confirm'|'pick'|'strategy'|'convention',
  debtId?, candidates?:[id…≤6], draft:{ kind, effectiveOn, amountMinor, strategy? } | { name, lender, ownerScope, terms },
  preview:{ interest, charges, principal, balanceAfter } }
```

- **Index wiring.**
  - `intentFor` and `assistantPrompt` gain `debt`.
  - `handleTextOrReceipt` routes `intent==='debt'` to `handleDebt`.
  - `handleUpdate` routes the `nia:pick:`, `nia:strat:`, `nia:conv:` and `nia:simpay` callbacks.
  - `confirmPending` routes `pending.kind==='debt'` to `confirmDebt`.
  - `appwriteRequest` helpers gain `queryGreaterEqual`, `queryLessThan` and `queryCursorAfter` for the cashflow query (`occurredAt` from the start of month −3 to the start of the current month, paginated).
- **Writes.** Create writes the debt row with ID `db{pendingId}` (`409` = done) and its `disbursement` event. Pay writes through `commitPlan` with `dedupeKey debt:{pendingId}`.
- **Advise.**
  - Flow: `compareStrategies` and `cashflowSignals` feed `advise(thresholds)`.
  - Thresholds come from `ADVICE_DEFAULTS` `{tightMarginRatio:0.10, maxInstallmentToIncome:0.30, higherRateGapPct:0}`. They can be overridden with env `DEBT_ADVICE_THRESHOLDS` (JSON) in Nia, or as an `advise` option on the web. With the default gap of 0, any strictly higher EA counts.
  - The deterministic verdict uses two signals:

    | Signal | True when |
    |---|---|
    | `tightMargin` | The 3-month average `income − expense` is below `tightMarginRatio × avgIncome`, OR `installment / avgIncome` exceeds `maxInstallmentToIncome` |
    | `higherRateDebt` | Another active debt has `EA > thisEA + higherRateGapPct` |

  - The rules are evaluated in this order, and the first match wins:

    | Order | Condition | Verdict |
    |---|---|---|
    | 1 | This debt is at 0% | `liquidity_only`. No interest savings are claimed. If `higherRateDebt` is also true, it is added as a reason. |
    | 2 | `tightMargin` | `reduce_installment`. Cites the margin and/or the ratio. |
    | 3 | `higherRateDebt` | `avalanche`. Names the higher-rate debt. |
    | 4 | Otherwise | `reduce_term` |

  - When signals 2 and 3 both apply, liquidity wins and the verdict is `reduce_installment`. `reasons` still includes `higher_rate_debt`, so the reply mentions it. Rationale: with a tight cash margin, a missed installment costs late interest plus credit damage, which outweighs the rate difference that avalanche captures. This also matches the spec's "Tight margin" scenario, which has no exception.
  - `buildFacts` produces pre-formatted strings. Gemini paraphrases them, then `guardParaphrase` checks the result. On `null` or a Gemini error, the deterministic template is used.
- **Analysis snapshot.** `workspaceSnapshot` adds code-computed debt summaries (S9).

## Nia in-repo and packaging (S0, gated)

Gitlink resolution (apply runs it only after the owner explicitly confirms at apply time):

1. Verify the starting state:
   - `git -C <root> ls-files -s functions/nia` shows mode `160000`.
   - Record `git -C <root>/functions/nia status --porcelain` and `rev-parse HEAD`.
2. Back up outside the repo:
   - Copy `functions/nia/.git` to `%USERPROFILE%\backups\finanzasplus-nia-git-<timestamp>\`.
   - Run `git -C functions/nia bundle create <backup>\nia.bundle --all`, then `git bundle verify`.
3. Run `git -C <root> rm --cached functions/nia`. This changes the index only; the working tree is untouched.
4. Delete `functions/nia/.git` only after the backup is verified.
5. Run `git -C <root> add functions/nia/index.js functions/nia/package.json functions/nia/README.md` (plus the lockfile if present). These are explicit paths, so the working-tree state, uncommitted changes included, is what gets staged. `node_modules/` is already ignored at any depth.
6. Run `git -C <root> rm --cached functions/nia.tar.gz functions/nia-deploy.tar.gz`. The files stay on disk.
7. Never use `git add -A` or `commit -a`. The working tree holds unrelated changes.

**Rollback:** restore `.git` from the backup, run `git rm -r --cached functions/nia`, then `git update-index --add --cacheinfo 160000,<sha>,functions/nia`.

`scripts/package-nia.mjs` exports `packageNia({outDir='dist-nia', tarPath='functions/nia.tar.gz'})` and runs these steps:

1. Vite `build({ configFile:false, logLevel:'warn', ssr:{ external:['undici'] }, build:{ ssr:'functions/nia/index.js', target:'node16', outDir, emptyOutDir:true, minify:false, rolldownOptions:{ output:{ format:'esm', entryFileNames:'index.js' } } } })`.
2. Write `dist-nia/package.json` (`type: module`, `main: index.js`, `undici@5.28.5`, `engines>=16`) from `functions/nia/package.json`.
3. Post-build API scan for the Node16-forbidden APIs. A match fails the build.
4. `scripts/lib/tar.mjs` writes ustar entries and gzips them with `zlib`.

Repo changes:

- `package.json` adds `"package:nia"`.
- `.gitignore` adds `dist-nia/`.
- `.dockerignore` adds `dist-nia`. `packages/` must stay included.
- `docs/setup.md`, `docs/deploy.md` and `functions/nia/README.md` describe `npm run package:nia`, the tarball upload, and the migration re-run.

## Data Flow

```
debts + debt_events ──listAllRows──> useDebtData ──project()──> debtViewModel ──> Views
        ▲                                    │ planCommit/commitPlan
        └──── event (unique dedupeKey) ◄─────┤
transactions (cost row dc{eventId}) ◄────────┘ ──> existing KPIs / budgets / CSV / Nia snapshot
Telegram → index.js → debt/handler → Gemini extract → core → preview → pending → confirm → commitPlan
```

## File Changes

| File | Action |
|---|---|
| `packages/finance-core/**` | Create (core, tests, fixtures) |
| `vite.config.js` | Modify (`@finance-core` alias) |
| `scripts/migrate-appwrite.mjs` | Modify (2 tables, 1 column, 1 index) |
| `src/appwrite.js` | Modify (`TABLES.debts/debtEvents`, `listDebts`, `listDebtEvents`, `createDebt`, `createDebtEvent`, `findDebtEventByDedupe`, `createCostRow`, `updateCostRow`, `deleteCostRow`, `listCostRows`, `ensureCostCategory`, `debtPort()`) |
| `src/features/debts/**` | Create |
| `src/features/shell/navItems.js`, `MoreSheet.jsx`, `src/app/FinanceShell.jsx` | Modify |
| `functions/nia/index.js` | Modify (gitlink resolved; debt wiring) |
| `functions/nia/debt/**` | Create |
| `scripts/package-nia.mjs`, `scripts/lib/tar.mjs` | Create |
| `package.json`, `.gitignore`, `.dockerignore`, `docs/setup.md`, `docs/deploy.md`, `functions/nia/README.md` | Modify |
| `functions/nia.tar.gz`, `functions/nia-deploy.tar.gz` | Untrack |

## Testing Strategy (strict TDD, Vitest default include discovers `packages/**`, `functions/nia/**`, `scripts/**`)

| Slice | RED-first tests | Approach |
|---|---|---|
| S0 | `scripts/package-nia.test.js`: runs `node scripts/package-nia.mjs --out <tmp>` through `execFileSync(process.execPath, [...])`, imports the bundle, and checks that a GET returns `{ok:true, service:'nia'}`. It also asserts that every `import` in `dist-nia/index.js` is a `node:` built-in or `undici`, so no relative or `packages/` path resolves outside the archive, and that the tar holds exactly `index.js` and `package.json`. `scripts/lib/tar.test.js`: header checksum, 512-byte padding. `src/test/niaInRepo.test.js`: `git ls-files -s` shows mode 100644, no nested `.git`, no `node_modules` or tarballs tracked. | `// @vitest-environment node` |
| S1–S3b, S7 core | Golden fixtures (`test/fixtures/*.json`, hand-checked against real statements: consumer French, German mortgage, libranza with insurance+GMF+IVA, leasing balloon, card statement), compared to the peso. Property tests use a seeded `mulberry32` (10-line helper, no new deps) over 200 random terms: principal sums to P, final balance 0, all integers ≥0, rate round-trip within 1e-12, reduce_term saves ≥ reduce_installment at a fixed rate, void restores the pre-event projection. Static Node16 scan. | Pure unit |
| S4 | `commitPlan` with a fake port: a `409` on the event leads to a lookup, a `409` on the cost row counts as success, `costMinor=0` writes no row, void deletes `dc{id}`. Migration definitions snapshot (columns, sizes, unique index). | Unit + `vi.mock('appwrite')` as in `src/appwrite.test.js` |
| S5–S7 web | `wizardModel` reducer per kind. RTL for list totals, wizard happy path, payment split preview, strategy prompt, simulator table, nav entries (Sidebar, MoreSheet). Load failure shows an error panel and retry; save failure keeps the dialog open with the error, and the balance stays unchanged; retry reuses the nonce. Plan rows show status chips. Card: paying the minimum is not past due, paying less is. | jsdom + user-event, `vi.mock('../../appwrite')` |
| S8–S9 Nia | `findDebt` (accents, ambiguity, single fallback), pending at most 1.5 KB, `callback_data` at most 64 bytes, dedupe on double confirm (fake deps), `guardParaphrase` (an extra number falls back to the template), `clampTelegram`, cashflow signals, `advise` truth table (0%, tight margin, higher rate, both tight and higher rate leading to `reduce_installment` with a `higher_rate_debt` reason, default, gap 0 meaning strictly higher). | Pure modules with injected deps |

## Slices (≤800 lines each, tests included)

| # | Files | Est. lines |
|---|---|---|
| S0 `size:exception` | `functions/nia/*` (about 1100, mechanical move), `scripts/package-nia.mjs`, `scripts/lib/tar.mjs`, tests, ignore files, docs | about 1100 moved + 300 new |
| S1 | `money.js`, `calendar.js`, `rates.js`, `legal.js`, `index.js`, node16 test, tests | 520 |
| S2 | `terms.js`, `schedule/*`, `charges.js`, fixtures, property helper, tests | 740 |
| S3a | `ledger/events.js`, `allocate.js`, `project.js`, `commit.js`, tests | 760 |
| S3b | `prepay/*`, `advice/*`, tests | 600 |
| S4 | migrate script, `src/appwrite.js`, `vite.config.js` alias, tests | 380 |
| S5 | nav, MoreSheet, FinanceShell, `DebtsContainer`, `useDebtData`, `debtViewModel`, `DebtsView`, `DebtCard`, wizard (loan kinds), tests | 760 |
| S6 | `DebtDetail`, `PlanTable`, `EventHistory`, `PaymentDialog`, `PrepaymentSimulator`, reconcile, tests | 760 |
| S7 | `card/card.js` + projector registration, `CardStep`, card detail bits, tests | 680 |
| S8 | `functions/nia/debt/{extract,findDebt,pending,preview,handler}.js`, `index.js` wiring, tests | 740 |
| S9 | `replies.js`, `guard.js`, `cashflow.js`, advise/simulate wiring, snapshot summary, tests | 540 |

S2, S3a, S5, S6 and S8 sit within 60 lines of the limit. If a slice overflows, split its tests or fixtures into an `a`/`b` pair rather than exceeding 800.

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | N/A: nothing classifies or executes files by path | — | — |
| Git repository selection | **Applicable**: a nested repo sits inside the parent during S0 | Every command uses `git -C <absolute path>`. Abort if `rev-parse --show-toplevel` from `functions/nia` is not the nested root before backup. | `niaInRepo.test.js`: index mode 100644, no `functions/nia/.git` |
| Commit state | **Applicable**: unrelated uncommitted changes exist | Explicit pathspecs only. No `-A`, no `commit -a`. Tarballs untracked with `--cached`. | `niaInRepo.test.js`: `node_modules` and `*.tar.gz` not tracked |
| Push state | N/A: there is no push automation; delivery follows the native flow | — | — |
| PR commands | N/A: no PR composition | — | — |
| Subprocess (packaging) | **Applicable** (test-only spawn) | `execFileSync(process.execPath, [script, '--out', tmp])`, no shell. Tar runs in-process. | `package-nia.test.js` |

## Migration / Rollout

- **Additive schema.** Run the migration before S4. Existing rows are untouched. Rollback = revert the code; the tables may stay.
- **Nia.** Deploy a new `functions/nia.tar.gz` only after S0, then after S8 and S9. Rollback = redeploy the previous tarball.

## Open Questions

- [ ] `biweekly` is modeled as every 14 days. Libranza "quincenal" (the 15th and month end) may need a `semimonthly` periodicity.
- [ ] Transactions API spike result on 1.8.1 (S4). The design works without it.
- [ ] Should reconcile-on-read write automatically, or ask first? It currently writes and reports with a toast.
- [ ] Card first-cycle day count. v1 approximates it and relies on `adjustment`.
