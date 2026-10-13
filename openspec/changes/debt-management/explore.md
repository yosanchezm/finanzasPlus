# Exploration: debt-management

Debts are modeled as an append-only ledger (`debts` + `debt_events`). Schedules are computed on the fly by a dependency-free ESM core in `packages/finance-core/`, which both the web app and Nia import. Nia moves into the repo as plain files and is bundled and tarred by a packaging script. Debt payments never expense the principal. Only interest, fees, insurance and taxes become expense rows.

## 1. Current state

### Web

| Area | Finding |
|---|---|
| Navigation | `src/features/shell/navItems.js` (`NAV_ITEMS`) drives `Sidebar`. `MobileTabBar` and `MoreSheet` are hard-coded and need edits too. |
| Container | `src/app/FinanceShell.jsx` is the single container: `activeView` state, no router, lazy views, `PERIOD_VIEWS` for month-gated views. |
| Closest analogue | Goals: not month-scoped, loaded from `workspace`. Debts should also apply the ownerScope filter. |
| Data loading | `getWorkspace()` in `src/appwrite.js` loads household, members, categories, budgets and goals in one `Promise.all`. `listAllRows` already paginates with a cursor. |
| Known race | Goal contribution is read-modify-write (`currentMinor + amount`) on both web and Nia. A stale read loses updates. An append-only ledger avoids this. |

### Schema (`scripts/migrate-appwrite.mjs`)

- The migration is create-only. It never alters columns.
- String sizes are immutable once created.
- `longtext` means `string(8000)`.
- `goals` and `budgets` grant team read/create/update. `transactions` grants team create plus per-row read/update/delete.

### Nia (`functions/nia/index.js`, 1094 lines, no tests)

- One Gemini prompt covers every intent: `transaction|budget|goal|category|analysis|conversation`.
- Pipeline: `normaliseOperation` → `resolveOperation(snapshot)` → `operationSummary` + `confirmationKeyboard` → `bot_sessions.pendingJson` → `confirmOperation`.
- Adding a resource touches six places: `intentFor`, `normaliseOperation`, `resolveOperation`, `operationSummary`, `listReply`/`missingLabel` and `confirmOperation`.
- `pendingJson` is capped at about 7600 characters, chat history included.
- `workspaceSnapshot` reads 100 unordered rows per table.
- The `analysis` intent asks Gemini to do arithmetic over raw JSON. That is unacceptable for debt math.
- Only the transaction path is deduplicated (`ai_events.inputHash`). The operation path is not, so a Telegram retry or a double tap duplicates a write.

### `transfer` is half-supported

| Where | Behavior |
|---|---|
| Nia | Emits `transfer` |
| Web KPIs, `aggregateMonthlyTotals` | Ignored |
| `buildCashflowSeries`, `TransactionsView` net, CSV export | Counted as expense |
| `TransactionRow` | Shown with a "−" sign |
| `TransactionModal` | Not offered |

Debt payments must not rely on `transfer`.

### Nia packaging

- `functions/nia` is a dangling embedded repo. The parent tracks it as a gitlink (mode 160000) and there is no `.gitmodules`.
- The nested repo has a single "init" commit with 3 blobs (`index.js`, `package.json`, `README.md`), plus uncommitted changes. Remote: `yosanchezm/nia`.
- The Function runtime is Node ≥16, so the shared core must avoid `findLast`, `toSorted`, `structuredClone` and `Object.groupBy`.
- `.dockerignore` excludes `functions`, `scripts` and `docs`. Shared code under `functions/` would break the web Docker build.
- `.gitignore` already ignores `functions/*.tar.gz`, but both tarballs are tracked.
- `rolldown` is available transitively through Vite 8. `esbuild` is not installed.
- Appwrite 1.8.0 adds a TablesDB Transactions API, and the SDK exposes `transactionId`. Availability on the self-hosted 1.8.1 instance needs a spike.

## 2. Domain notes (Colombia)

[V] marks verified facts. [U] marks unverified ones, which must stay configurable.

### Rate conventions

Store the rate as stated by the bank: `{value, basis, periodicity, timing}`. Derive the periodic rate in pure code.

| From | Formula |
|---|---|
| Effective annual (EA) | `i = (1+EA)^(1/n) − 1` |
| Nominal annual j, compounded m times (NAMV: m=12; NATV: m=4) | `i = j/m`; `EA = (1+j/m)^m − 1` |
| Anticipated | `i = ia/(1−ia)`; `EA = (1−ia)^−m − 1` |
| Interest-free | `i = 0` |

- Payment periodicities: weekly, biweekly, monthly, bimonthly, quarterly, semiannual, annual.
- Clamp due days at month end.

### Usury cap [V, secondary source]

- The cap for consumo y ordinario is 28.59% EA (IBC 19.06%), valid 1–31 October 2026.
- It changes monthly and differs by modality. Mortgage caps differ [U].
- Use it as a warning only, together with its `asOf` date.

### Credit cards [V]

- A card has a statement day, a due day and a minimum payment.
- Purchases paid in one installment are interest-free if paid in full. The revolving balance accrues interest at the card rate.
- Purchases deferred to N installments each carry their own rate (the rate in force on the purchase day).
- Cash advances accrue interest from day one.
- The card management fee (cuota de manejo) is charged monthly.
- Model a card as a parent debt with tranches: revolving, deferred plans, advances.

### Amortization systems

- French: fixed installment, `PMT = P·i/(1−(1+i)^−n)`.
- German: constant principal.
- Bullet: single payment at maturity.
- Interest-only, with an optional balloon.
- Grace period: total (interest capitalized) or principal-only.
- Balloon / residual value: leasing and vehicle loans.
- Manual / irregular: informal and family loans.

Notes:

- 0% family loans use either manual or French with `i = 0`.
- Libranza is French plus charges.
- UVR mortgages are deferred. Keep `unit: COP|UVR` as an extension point.

### Charges per installment

A charge has the shape `{kind, label, basis, value, cadence, fromPeriod, toPeriod}`. The `basis` is one of:

| Basis | Example |
|---|---|
| `fixed` | Flat amount per installment |
| `pctOutstanding` | Percentage of the outstanding balance |
| `pctOriginal` | Percentage of the original amount |
| `pctOfBase` | Fire / earthquake insurance on property value |
| `pctOfSubtotal` | GMF (4 por mil) |
| `pctOfCharge` | IVA on a fee |

- `cadence` includes annual, for example vehicle all-risk insurance.
- Do not hard-code tax applicability [U].

### Ley 1555 de 2012 [V]

- Prepayment of peso credits carries no penalty.
- The debtor chooses between reducing the term and reducing the installment.
- It excludes mortgages and balances above 880 SMMLV, and credits granted before the law (C-313/2013 nuance).
- Mortgage prepayment falls under Ley 546/1999 art. 17 [U].
- Model `prepaymentPenaltyPct`, default 0, and always offer the choice. Informational only.

### Payment allocation

Charges and taxes → late-payment interest → current interest → principal. Configurable via `allocationOrder`.

## 3. Accounting decision

Rule: debt events never create principal expenses, and transactions never move a debt balance.

| Event | Treatment |
|---|---|
| Card purchase | Expense on the purchase date |
| Loan disbursement | No income row (it is a liability) |
| Payment principal | Reduces the ledger balance only |
| Interest + charges + taxes | One expense row (real cost) |

**Recommended: option A, materialized cost rows.** Each payment creates one `transactions` expense row:

- `amount` = interest + charges
- `source: 'debt'`
- new optional column `debtId`
- `dedupeKey = debt:{eventId}`
- category: get-or-create "Costos financieros"

Existing KPIs, budgets, CSV export and Nia's snapshot then work unchanged. Write atomically through the Transactions API if available. Otherwise rely on an idempotent `dedupeKey` plus reconcile-on-read.

| Option | Pros | Cons |
|---|---|---|
| A: materialized cost rows | Zero change to existing aggregations | Dual write; voiding a payment must also void its row |
| B: virtual merge at read | No dual write | Every aggregation, CSV and Nia's snapshot must change |
| C: whole payment as `transfer` | Cash outflow is visible | Requires cleaning up `transfer` first; defer until accounts exist |

Open point: card purchases auto-raising the card balance. Proposal for v1:

- The card balance is driven by statements.
- Transactions get an optional `debtId`.
- A derived `charge` event is added later.

## 4. Modeling

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| (a) Stored schedule rows | Simple reads; freezes the bank plan | 360 rows per mortgage; non-atomic rewrites on every change; two sources of truth | Medium |
| (b) Event ledger + computed schedule | Single source of truth; pure functions; same code on web and Nia; no lost updates | Engine correctness is on us; bank rounding drift | Medium-High |
| (c) (b) + denormalized cache | Fast lists | A stale cache is dangerous for money advice | High |

**Recommendation: (b), no cache in v1.**

### Tables

- `debts`: householdId, name, kind, ownerScope, lender, status, currency, principalMinor, openedAt, termsJson (longtext, versioned), termsVersion.
- `debt_events`: householdId, debtId, kind, occurredAt, amountMinor, payloadJson, transactionId, actorId, source, dedupeKey (unique), voided.

### Event kinds

- `disbursement`
- `payment`
- `extra_payment` (carries a strategy: reduce_term | reduce_installment | advance_installments)
- `rate_change`
- `charge_change`
- `restructure`
- `adjustment` (reconcile against a statement)
- `void`

Corrections are a void event plus a new event. Events are never edited.

### Recalculation

`project(terms, events, asOf)` walks the events chronologically:

| Situation | Behavior |
|---|---|
| Short payment | Allocate by `allocationOrder`; the shortfall becomes past due (optional late interest) |
| Extra payment, reduce term | Keep the installment, recompute the term |
| Extra payment, reduce installment | Re-amortize over the remaining term |
| Advance installments | No interest saving |
| Rate change | Applies from its effective date, with `keep_term` or `keep_installment`; variable-rate indexes are updated manually in v1 |
| Restructure | New terms version |

- Dates are plain `YYYY-MM-DD` strings, never `Date` objects.
- Amounts are integer pesos. The rounding residual goes to the last installment.
- Property tests check that principal sums to P and that the final balance is 0.

## 5. Bot UX

- New `intent: 'debt'` with actions `create|pay|simulate|advise|list`.
- A specialized second Gemini call runs only for `debt`, receiving the debt names. The LLM only extracts; code validates and computes.

### Rates

- The model extracts `{value, period, compounding, timing, rawText}`.
- The preview echoes the conversion (e.g. "2.1% MV ≈ 28.3% EA") and the usury warning.
- If the convention is missing, ask with inline buttons.

### Selector

- `findDebt` matches name, lender and kind with NFD accent folding. The existing `sameText` only lowercases.
- If several debts match, show a `nia:pick:{id}` keyboard.
- If none match and only one debt is active, use it.

### Pay

- The preview shows the split (charges / interest / principal), the new balance, the next installment and the plan effect.
- If the amount exceeds the installment, ask for a strategy.
- Confirm writes the event and the cost row.
- `dedupeKey = debt:{pendingId}` makes it exactly-once.
- The compact pending payload is about 1.5 KB or less.

### Simulate

- Read-only, no confirmation needed.
- Compares reducing the term against reducing the installment and offers a button to turn the simulation into a payment.
- Shows only the next 3–12 rows (Telegram's limit is 4096 characters) and links to the web view or a CSV.

### Advise (deterministic)

Code computes, for both strategies:

- new term and new installment
- interest and charges saved
- cashflow signals: 3-month income − expense via a date-range query, installment-to-income ratio, higher-rate debts

Reasoning:

- At a fixed rate, reducing the term always saves at least as much interest as reducing the installment. Fixed charges widen the gap.
- Default verdict: reduce the term.
- Recommend reducing the installment, or attacking the higher-rate debt first (avalanche), when the cash margin is tight or a higher-rate debt exists.
- At 0%, the choice is only about liquidity.
- Thresholds are configurable.

Guardrails:

- Gemini only paraphrases the structured `facts` and must not compute.
- Every number in the reply must appear in `facts`; otherwise fall back to a deterministic template.
- Code-computed debt summaries are also fed into the `analysis` snapshot.

## 6. Bringing Nia into the repo, and sharing code

### Resolve the gitlink

This step is destructive and needs owner confirmation.

1. Back up `functions/nia/.git` outside the repo.
2. `git rm --cached functions/nia`.
3. Remove the nested `.git`.
4. `git add` the files, keeping the uncommitted working-tree state.
5. Keep the GitHub remote as an archive.

### Layout

```
packages/finance-core/   # dependency-free ESM, Node 16+, browser-safe
functions/nia/           # imports ../../packages/finance-core/index.js
scripts/package-nia.mjs  # bundle + tar
```

### Packaging options

| Option | Verdict |
|---|---|
| Vite SSR build (`target node16`, `undici` external) → `dist-nia/index.js` → `tar -czf functions/nia.tar.gz` | **Recommended** |
| Copy into a vendor folder | Fragile |
| `package.json` `imports` | Not viable: targets outside the package are rejected |
| Shared code under `functions/` | Breaks the web Docker build |

Optional: raise the Function runtime to Node 22. This removes `undici` and allows modern JS.

## 7. Slicing (≤800 lines each, tests included)

| # | Slice | Lines (approx.) | Depends on |
|---|---|---|---|
| S0 | Nia in-repo + packaging script + smoke test (mechanical; `size:exception`) | 1100+ | none |
| S1 | Core: rates, conversions, usury helper | 400 | none |
| S2 | Core: amortization systems, charges, grace, rounding | 700 | S1 |
| S3a | Core: ledger `project()`, allocation, void | 700 | S2 |
| S3b | Core: prepayment strategies, comparison, advisory signals | 600 | S3a |
| S4 | Schema (`debts`, `debt_events`, `transactions.debtId`) + data layer + atomic cost row | 350 | S3a |
| S5 | Web: nav, list, create wizard (loans), totals | 700 | S4 |
| S6 | Web: detail, plan, record payment, extra-payment simulator | 750 | S5 |
| S7 | Web: credit card (tranches, statement/due dates, minimum payment, management fee) | 600 | S6 |
| S8 | Nia: create / list / pay, selector, dedupe | 700 | S0, S4 |
| S9 | Nia: simulate / advise with guardrails | 500 | S3b, S8 |

Later: UVR, variable-rate indexes, due-date reminders, editing terms.

## Risks

- Money-math correctness and rounding. Mitigate with golden fixtures from real statements and property tests.
- The LLM misreading a rate convention. Mitigate by echoing the conversion and requiring confirmation.
- Immutable string columns and the 8000-char cap. `termsJson` carries a `schemaVersion`.
- The dual write (event + cost row) if the Transactions API is unavailable.
- Node 16 constraints on shared code.
- Deleting the nested `.git` is destructive, and uncommitted work must be preserved.
- Legal figures change or are unverified. Show them as information only.
- Card quirks (day count, first-statement interest). The `adjustment` reconcile event covers drift.
- Existing issues: `transfer` inconsistency and the goal read-modify-write race.
- "Very complete" versus the 800-line budget. A fixed MVP and chained slices keep it manageable.

## Open questions for the owner

1. Accounting rule: only cost rows are expenses, and card purchases are expensed when made?
2. Card balance in v1: driven by statements, or raised automatically by purchases?
3. UVR mortgages in v1?
4. Drop the nested `.git` and keep the remote as an archive?
5. Raise the Function runtime to Node 22?
6. Manual rate updates for variable-rate loans?
7. Usury cap: a manual table, or fetched automatically?
8. Due-date reminders (proactive Telegram messages) in scope?
9. Can either partner void events?
10. Web Nia chat in scope, or Telegram only?

## Sources

- https://www.dmsjuridica.com/buscador_20179478954/legislacion/leyes/?p=1618
- https://www.superfinanciera.gov.co/publicaciones/61676
- https://www.noticiasrcn.com/economia/tasa-usura-octubre-2026-1068529
- https://appwrite.io/docs/products/databases/tablesdb/transactions
- https://www.bancolombia.com/educacion-financiera/finanzas-personales/como-saber-interes-tarjetas-de-credito
