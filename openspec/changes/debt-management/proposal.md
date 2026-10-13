# Proposal: Debt Management (cards and loans, web + Nia)

Track every household debt as an append-only ledger. A shared pure core computes plans, simulations and advice. The web app and the Telegram bot Nia both use that core, and Nia moves into this repo.

## Intent

| Problem today | Outcome after |
|---|---|
| The app does not track credit cards or loans. | Every common debt form can be recorded, followed and paid from the web and from Nia. |
| Banks state rates in mixed conventions (EA, NAMV, MV, NATV, anticipated). | Any convention is accepted, and the app shows explicit conversions. |
| Insurance, GMF, IVA and fees hide the real cost of a debt. | Plans show the charges on each installment, and only the real cost is booked as an expense. |
| "Reduce the term or the installment?" has no grounded answer. | A deterministic comparison, with a recommendation that explains itself. |
| Nia lives in a dangling gitlink and cannot share code. | Nia is plain files in this repo, bundled into the tar.gz by a script. |

## Scope

### In scope

- Debt kinds:
  - credit cards (revolving balance, deferred-purchase tranches, cash advances, management fee, statement and due days, minimum payment);
  - consumer, vehicle and peso mortgage loans;
  - libranza;
  - leasing-like loans with a balloon payment;
  - 0% family loans;
  - irregular loans with no plan.
- Rates: store `{value, basis, periodicity, timing}`. Convert in both directions and show the EA equivalent.
- Amortization systems: French, German, bullet, interest-only with balloon, grace periods (total or principal-only), and manual.
- Charges on each installment: fixed, % of balance, % of original amount, % of a base, % of the subtotal (GMF), % of another charge (IVA). Each charge has a cadence and a period range.
- Ledger events: disbursement, payment, extra payment (reduce term, reduce installment, or advance installments), rate change, charge change, restructure, adjustment, void. The plan is recalculated from these events.
- Web: navigation entry, debt list with totals, create wizard, detail with plan, record a payment, and an extra-payment simulator.
- Nia (Telegram): create, list, pay ("I paid X"), simulate, and advise (reduce term vs. reduce installment). Every write requires confirmation and is exactly-once.
- Usury-cap and Ley 1555 notices with an `asOf` date. They inform and never block.
- Nia moves into this repo, and `scripts/package-nia.mjs` produces the tar.gz.

### Out of scope (v1)

- UVR mortgages. `unit: COP|UVR` stays as an extension point.
- Automatic variable-rate index feeds. Rate changes are entered manually as `rate_change` events.
- Automatic usury-rate fetching. A manual table is used instead.
- Due-date reminders and proactive Telegram messages.
- Web Nia chat.
- Linking a transaction to a card debt automatically (deferred to a follow-up).
- Editing terms in place (use `restructure`).
- Cleaning up `transfer`.
- Fixing the goal read-modify-write race.
- Upgrading the Function runtime to Node 22.

## Capabilities

### New capabilities

- `nia-in-repo-packaging`: Nia lives as files in the repo, and a bundle-and-tar script produces the tar.gz.
- `interest-rate-conversion`: rate conventions, periodic and EA conversions, and the usury warning.
- `debt-amortization-schedule`: amortization systems, charges, grace periods and rounding.
- `debt-ledger`: debts and events, `project()`, payment allocation, voids, and the cost-only expense rows.
- `debt-prepayment-advice`: extra-payment simulation, strategy comparison and deterministic advice.
- `debt-web-management`: web list, create wizard, detail, plan, payment and simulator.
- `credit-card-debt`: card tranches, statement and due days, minimum payment, management fee.
- `nia-debt-assistant`: the Telegram debt intent, debt selector, dedupe, and paraphrase guardrails.

### Modified capabilities

- None. `openspec/specs/` is empty. The new `transactions.debtId` column is specified under `debt-ledger`.

## Approach

- **Ledger.** Use ledger approach (b): `debts` and `debt_events` tables. Schedules are computed by `project(terms, events, asOf)` in `packages/finance-core/`, with no denormalized cache.
- **Core.** The core is dependency-free ESM and Node16-safe. Dates are `YYYY-MM-DD` strings. Amounts are integer pesos.
- **Accounting (option A).** A payment writes one `transactions` expense row with `source: 'debt'`, `debtId`, `dedupeKey = debt:{eventId}` and category "Costos financieros". The row amount is interest plus charges plus taxes.
  - The principal is never an expense.
  - Card purchases are expensed when they are made.
  - Writes use atomic TablesDB Transactions if the spike confirms they work. Otherwise they rely on an idempotent `dedupeKey`.
- **Nia.** The LLM only extracts fields. Code validates and computes. Gemini paraphrases a structured set of `facts`. If the reply contains any number that is not in `facts`, Nia falls back to a deterministic template.
- **Packaging.** A Vite SSR build (`target node16`, `undici` external) produces `dist-nia/`, which is then tarred.

## Affected areas

| Area | Impact | Change |
|---|---|---|
| `packages/finance-core/` | New | Rates, schedules, ledger, advice |
| `src/features/debts/` | New | Views, wizard, simulator |
| `src/features/shell/navItems.js`, `MobileTabBar.jsx`, `MoreSheet.jsx`, `src/app/FinanceShell.jsx` | Modified | Navigation and lazy view |
| `src/appwrite.js` | Modified | Debt data layer and the cost-row write |
| `scripts/migrate-appwrite.mjs` | Modified | New `debts` and `debt_events` tables; `transactions.debtId` (additive) |
| `functions/nia/index.js` | Modified | Gitlink resolved; `debt` intent |
| `scripts/package-nia.mjs`, `package.json` | New / Modified | Bundle and tar |
| `.gitignore`, tracked `functions/*.tar.gz` | Modified | Stop tracking the tarballs |
| `docs/deploy.md`, `docs/setup.md` | Modified | Packaging and migration steps |

## Slice plan (auto-chain, at most 800 lines per slice)

| # | Slice | Depends on |
|---|---|---|
| S0 | Nia in-repo, packaging script, smoke test. **`size:exception`**: a mechanical move of about 1100 existing lines. | none |
| S1 | Core: rates, conversions, usury helper | none |
| S2 | Core: amortization systems, charges, grace periods, rounding | S1 |
| S3a | Core: `project()`, payment allocation, void | S2 |
| S3b | Core: prepayment strategies, comparison, advice signals | S3a |
| S4 | Schema, data layer, cost row | S3a |
| S5 | Web: navigation, list, loan wizard, totals | S4 |
| S6 | Web: detail, plan, payment, simulator | S5 |
| S7 | Web: credit card | S6 |
| S8 | Nia: create, list, pay, selector, dedupe | S0, S4 |
| S9 | Nia: simulate and advise, with guardrails | S3b, S8 |

## Assumptions (the owner can override any of these)

1. Accounting follows option A: cost-only expense rows. The principal is never an expense. Card purchases are expensed when made. `transfer` is not used.
2. The ledger follows approach (b): the core computes the schedule, and there is no cache in v1.
3. In v1 the card balance is driven by statements and manual entries (`charge` and `adjustment` events). The transaction→debt link is a follow-up.
4. The v1 exclusions listed under "Out of scope" stand.
5. Any household member may record or void debt events. `actorId` is audited.
6. S0 runs only after the owner confirms it explicitly at apply time. Before touching `functions/nia/.git`, apply backs up the nested `.git`, untracks the gitlink, and adds the files with their uncommitted state preserved.
7. The shared core stays Node16-compatible. Upgrading to Node 22 is an optional follow-up on the owner's side.
8. Legal figures (usury cap, Ley 1555 scope) only produce informational warnings.

## Proposal question round (owner review)

1. Do bank statements show insurance and GMF as separate lines? This determines how charges are configured by default.
2. When cash is tight, should the advice prioritize liquidity (reduce the installment) or total interest saved?
3. Which debts must work on day one? This would let the slice order be adjusted.
4. Should the cost row be booked against the household or against the owner's scope?

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Money-math or rounding drift against the bank | Med | Golden fixtures from real statements, property tests, `adjustment` events |
| LLM misreads the rate convention | Med | Echo the conversion and require confirmation |
| Dual write (event and cost row) without Transactions | Med | Idempotent `dedupeKey`, reconcile on read |
| Immutable columns and the 8000-character limit on `termsJson` | Low | `schemaVersion` inside the JSON, compact terms |
| Destructive gitlink step | Low | Explicit confirmation and a backup outside the repo |

## Rollback plan

- **Schema.** All changes are additive (new tables and one optional column), so existing data is untouched. To roll back, revert the code. The tables can stay or be dropped manually.
- **Web.** Remove the debts views and the navigation entries.
- **Nia.** Remove the `debt` intent. Redeploy the previous tarball.
- **S0.** Restore the backed-up `functions/nia/.git` and re-add the gitlink.

## Success criteria

- [ ] Conversions and schedules match golden fixtures to the peso. In property tests, the principal sums to P and the final balance is 0.
- [ ] Every listed debt kind can be created and paid on the web and through Nia.
- [ ] "I paid X" records exactly one event and at most one cost row, even on a retry.
- [ ] Every number in Nia's advice matches a computed fact.
- [ ] `npm test` and `npm run build` pass. `scripts/package-nia.mjs` produces a tar.gz that deploys.
