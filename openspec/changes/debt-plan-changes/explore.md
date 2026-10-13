# Exploration: debt-plan-changes

This change covers three things:

- legal parameters (SMMLV, IBC and usury) that the user can set;
- rate changes, charge changes and restructures, entered from the web and from Nia;
- late interest (interés de mora).

The core already supports `rate_change`, `charge_change` and `restructure`: `planCommit` and `commitPlan` work for any event kind. What is missing is the UI, the previews and the Nia intents. Exactly-once handling (`findSaved`, `web:{nonce}`, `debt:{pendingId}`) is reused as is.

## Current state (verified in code)

### Ledger

`tail.js` (the logic that rebuilds a plan from an effective date):

- It rewrites only rows due after the effective date that have no payment.
- `keep_installment` works for French amortization only.
- `installment_too_low` is thrown both when the installment does not exceed the new interest and when the plan would run past 2000 periods.
- A restructure refinances what remains unpaid on rows due on or before the date, and increments `termsVersion`.
- The card projector handles `rate_change` and `charge_change` only.

### Web

- `debtDetailModel.VOIDABLE` excludes plan-change events.
- `EventHistory` shows plan-change events as `$ 0`.
- `reconcileCosts` runs only when a debt is opened.
- Wizard charges are tied to presets. `chargesOf` maps 5 presets, so a restructure dialog needs a new `ChargesEditor` and a `fromTerms` inverse.

### Late interest

- `terms.lateRate` is validated but never read.
- The `lateInterest` bucket already exists in `allocate` and `costOf`.
- `rowDue().lateInterest` is always 0.
- The card projector hard-codes 0.
- The schedule never charges regular interest on overdue principal. Mora on overdue principal is therefore the correct replacement, not a double charge.

### Legal values

- `USURY_TABLE` and `SMMLV_TABLE` live in code.
- `usuryNotice` accepts an injected table, but no production code passes one.
- Nothing reads SMMLV.
- "Ajustes" is disabled in the sidebar ("Próximamente").

### Nia

- Actions: `create|pay|simulate|advise|list`.
- Callbacks: `pick|strat|conv|simpay`.
- `nia:conv` applies to create only.
- There is no `updateRow` adapter.

### Call sites

About 13 production call sites invoke `project`, `planCommit`, `compareStrategies`, `simulateExtra` or `usuryNotice`.

## Requirement 1: Parameterizable SMMLV and usury

The Superfinanciera certifies the IBC per modality. Usury equals IBC × 1.5, rounded half up to 2 decimals; use basis points (for example, 19.49 gives 29.24). Mortgage and some other modalities do not follow the 1.5 rule, so an optional explicit cap override is needed.

Known modality catalogue: `consumer`, `low_amount`, `productive`, `productive_rural`, `productive_urban`, `popular_rural`, `popular_urban`, `mortgage` (manual).

### Storage

Recommended: a new household-scoped `legal_rates` table.

| Column | Type |
|---|---|
| `householdId` | s36 |
| `kind` | s16: `ibc` \| `usury` \| `smmlv` |
| `modality` | s24 |
| `validFrom` | s10 |
| `validTo` | s10 |
| `value` | float |
| `source` | s200 |
| `actorId` | s36 |

- Unique key: (`householdId`, `kind`, `modality`, `validFrom`).
- Team can read, create and update. There is no delete; a row is superseded by editing it.

Rejected alternatives:

- A JSON column on `households`: string size is immutable, there is no audit trail, and writes are last-write-wins.
- A key-value settings table.
- Code-only tables.

### Core

- `resolveLegal(rows, defaults)` returns `{usuryTable, smmlvTable}`. Database rows override the code defaults.
- `capOn(table, modality, date)` carries the latest cap forward with `stale: true` when no row covers the date.
- The notices accept the injected tables. `ley1555Notice` uses SMMLV (the 880 SMMLV scope must be verified).

### Threading

Loaded debts are decorated with `debt.legal`, and an `opts.legal` override is also accepted. Precedence: `opts.legal`, then `debt.legal`, then the code defaults. Two loaders set it: `useDebtData.load` and Nia's `loadDebts`.

### Web

- Enable Ajustes, with a "Tasas legales" section (`LegalRatesPanel`):
  - a table by modality and month, with stale and unverified badges;
  - a form with a month picker, an IBC-or-cap toggle and the derived value;
  - SMMLV by year.
- If the table is missing (migration not run), fall back to the code defaults and show a notice.

### Nia

- New `legal_rate` action, for example "la usura de noviembre es 28.2".
- The month is resolved in code.
- A preview echoes the value; Confirm writes it.
- A 409 response leads to an update, which needs an `updateRow` seam.
- Range guard: about 5 to 100.

## Requirement 2: Rate change, charge change and restructure (web and Nia)

### Web

A "Más acciones" menu in `DebtDetail` with Cambiar tasa, Cambiar seguros y cargos and Reestructurar. Cards get only the first two.

The dialogs use `useCommitDialog`, `saveDebtEvent` and `findSaved`. A new core `previewChange(debt, events, draft, {on})` returns:

- before and after values: next installment, remaining periods, last due date, remaining cost;
- `impacted`: past events whose cost would change.

After a save, call `reconcileCosts`.

**Rate change**

- Effective date, with a warning when it is in the past.
- `RateField` plus the EA echo and the usury notice.
- A `keep_term` / `keep_installment` choice; `keep_installment` is French only.
- Live preview.
- A specific `installment_too_low` message that pre-selects `keep_term`.

**Charge change**

- A `ChargesEditor` over real `Charge` objects.
- The edited set replaces the old one from the effective date.
- `pctOfCharge` references are validated.

**Restructure** (3 steps)

1. Current state: the arrears breakdown.
2. New terms: rate, system, periodicity, number of periods, first due date (must be after the effective date), grace or balloon, charges, and a "condonar mora" option.
3. Summary: before and after, the usury notice, and the `payload_too_large` check (8000 characters).

The payload is the full DebtTerms, with `principalMinor` set to the carried balance and `openedOn` to the effective date. Restructure is hidden for cards.

**History and void**

- History shows a summary for plan-change events instead of `$ 0`.
- `rate_change` and `charge_change` can be voided.
- A restructure can be voided only after a confirmation, and voiding is blocked if later payments exist.

### Nia

- New actions: `rate_change`, `charge_change`, `restructure`, `legal_rate`.
- New fields: `effectiveOn`, `mode`, `chargeRef`, `newValue`, `n`, `system`, `periodicity`, `firstDueOn`, `charges`, `waiveLate`.
- `nia:conv` is generalized to every action, and a new `nia:mode:keep_term|keep_installment` callback is added.
- `charge_change` from Nia only edits or removes an existing charge, matched by folded label or kind. Adding a charge is done on the web.
- A restructure pending stores only the overrides. The terms are rebuilt at Confirm time from the live debt.
- Exactly-once: `debt:{pendingId}`, `de{pendingId}`, a done marker, and "ya estaba registrado".
- A backdated change from Nia leaves cost rows stale until the debt is opened on the web. Either show a note, or move `planReconcile` into the core (about 150 lines).

### Arrears in a restructure

Today all arrears are refinanced. Once mora exists, it is refinanced too. Article 886 of the Código de Comercio limits capitalizing interest. Default: keep the current behaviour, plus a `waiveLate` option.

## Requirement 3: Late interest (mora)

### Legal notes (mostly secondary sources; to be confirmed)

- The cap is the usury rate, 1.5 × IBC (C.Co. art. 884, as amended by Ley 510/1999 art. 111). A rate above the cap forfeits the interest.
- Housing loans under Ley 546/1999 have their own rules, to be confirmed.
- Base: overdue principal only. Anatocism is restricted (C.Co. art. 886; C. Civil arts. 1617 and 2235).
- Payment imputation is interest before principal (C. Civil art. 1653).
- Collection fees (Ley 1328/2009) are out of scope. They can be entered through `bankSplit.charges`.

### Proposed model

`terms.late = { mode, rate?, multiple?, modality?, graceDays?, since? }`. When it is absent the mode is `none`, so existing debts do not change.

| Mode | Meaning |
|---|---|
| `none` | No mora is computed. Values reported by the bank in `bankSplit.lateInterest` still apply. |
| `usury` | Mora at the legal maximum of the day, for the debt's modality. |
| `fixed` | A fixed rate, capped by usury. |
| `contract_multiple` | `multiple` × the contract EA, capped. |

`terms.modality` can override the modality derived from the debt kind.

**Base**: unpaid principal of rows whose due date is before the accrual date. Interest, charges, taxes and capitalized grace interest never accrue mora.

**Window**: from the day after the due date (plus `graceDays`) until the payment date.

**Rate**

- Each day uses `EA = min(policy, cap(modality, day))`.
- Daily rate = `(1+EA)^(1/365) − 1`.
- Simple daily interest per segment: `base × daily × days`.
- Segments split at events, cap boundaries, contract-rate changes and `asOf`.

**Missing caps**

- Past the last known cap: carry the latest cap forward and add a `late_cap_stale` notice.
- No cap known at all: use the policy rate and add `late_cap_unknown`.

**Rounding**: keep an exact accumulator `lateExact` and round once when exposing the value.

**Inside `project()`**

- `accrueLate` runs before each event and once at `asOf`.
- `rowDue().lateInterest` = accrued − paid.
- `rowOutstanding` includes accrued mora, so `dueNow` and `pastDueMinor` include mora without changes in the callers.
- New fields: `lateInterestMinor`, `totals.remainingLateInterest`, and per plan row `lateMinor`, `lateDays` and `lateBaseMinor`.
- The existing allocation already pays mora first, and `costOf` already includes it in the cost row.

**Enabling mora on an existing debt**: a new event `late_policy {late}` with an effective date, so mora accrues only from that date. It is replayable and can be voided. Editing `termsJson` instead was rejected.

**Defaults**: bank loans `usury`; family and informal loans `none` (a fixed rate is allowed).

**Cards** (optional, last): mora on the principal part of the unmet minimum payment, billed in the next statement.

### Worked examples

Usury 28.59% EA gives a daily rate of 0.068917%, so 137.49 per day on 199,505.

| Scenario | Result |
|---|---|
| 199,505 overdue 10 days | 1,375 |
| 199,505 overdue 30 days | 4,125 |
| Pay the installment 390,381 on day 10 | Split: charges 10,000, mora 1,375, interest 180,876, principal 198,130. Cost row 192,251. Principal 1,375 stays overdue. |
| Pay 100,000 on day 10 | Split: charges 10,000, mora 1,375, interest 88,625, principal 0. |
| Pay 300,000 on day 10 | Principal 107,749 paid. The next 10 days on 91,756 give 632. |
| Cap changes mid-way (illustrative 27.50%) | 687.46 + 664.18, rounded once = 1,352 |
| Card, unpaid principal 125,000, 10 days | 861 |
| Family loan with `none` | 0 |

## Schema (additive; the migration only creates)

- New `legal_rates` table.
- No new columns on `debts` or `debt_events`:
  - `late` and `modality` go inside `termsJson`;
  - `late_policy` and restructure terms go inside `payloadJson` (8000 characters).
- Deploy order: run the migration, then deploy the web and the Nia tarball together. An old Nia bundle ignores `terms.late`.

## Recommendations

| Decision | Recommended | Rejected |
|---|---|---|
| Legal storage | `legal_rates` table plus code fallback | JSON column, key-value table, code only |
| Threading the legal table | `debt.legal` decoration plus `opts.legal` | Passing it explicitly at 13 call sites |
| Mora engine | Accrue inside `project()` by segments | An overlay on the projection, synthetic events |
| Enabling mora on an existing debt | `late_policy` event | Editing `termsJson`, using a restructure |
| Settings UI | Ajustes route with a `LegalRatesPanel` | A dialog only |
| Nia restructure | Full flow with overrides | Only a link to the web |

## Risks

- Retroactive cost drift once mora is on. Mitigation: default `none`, the `late_policy` date, and reconcile toasts.
- A stale usury table. Mitigation: carry the last cap forward, warn, and prompt for the monthly update.
- Web and Nia using different tables, so reconciled cost rows flip back and forth. Mitigation: one source (`legal_rates`) and the `debt.legal` decoration.
- A small leftover mora balance after paying exactly the installment.
- Stale cost rows after a backdated change made from Nia.
- Voiding a restructure that has later payments.
- `Math.pow` rounding at the last ulp. Mitigation: golden values in tests.
- The 8000-character payload limit.
- Legal accuracy. Present the rules as informational.
- Card mora is approximate; a statement adjustment wins.
- The jsdom test suite is flaky under load.

## Open questions for the owner

1. Mora defaults by kind: `usury` for bank loans and `none` for family and informal loans. Which treatment applies to mortgages?
2. Is mora charged on overdue principal only, or on the whole installment?
3. Does mora replace regular interest on overdue principal?
4. In a restructure, is all the arrears (mora included) refinanced, or is mora waived by default?
5. A full Ajustes screen, or a dialog?
6. Are collection fees out of scope?
7. Card mora in this change, or later?
8. Stale cap: carry forward with a warning?
9. Store the IBC and derive usury × 1.5, with an override?
10. Day count actual/365 with a simple daily rate?

## Slice plan (each slice ≤2000 lines, PRs ≤800)

| Slice | PRs (approximate lines) |
|---|---|
| A. Legal parameters | A1 core (450), A2 schema and data and `debt.legal` (500), A3 Ajustes `LegalRatesPanel` (700) |
| B. Rate and charge change on the web | B1 `previewChange` and void rules (350), B2 `RateChangeDialog` (650), B3 `ChargesEditor` and `ChargeChangeDialog` (500) |
| C. Mora in the core | C1 `terms.late` and `lateRateOn` (450), C2 accrual and project integration (550), C3 `late_policy` and restructure arrears / `waiveLate` (400) |
| D. Restructure and mora UI | D1 `RestructureDialog` (750), D2 mora in the wizard, detail, payment and history (650) |
| E. Nia legal values and plan changes | E1 `legal_rate` (600), E2 rate and charge change (750) |
| F. Nia restructure, mora, cards | F1 restructure (550), F2 mora (300), F3 card mora (700) |

Dependencies:

- A goes first.
- C needs A.
- B is independent of C.
- D needs B and C.
- E needs A and B.
- F needs C and D.

Total: about 9,000 lines.

## Sources

- https://www.superfinanciera.gov.co/publicaciones/19130
- https://actualicese.com/superfinanciera-certifica-el-interes-bancario-corriente-para-septiembre-2026/
- https://leyonline.co/laws/codigo-de-comercio/articulo-886-anatocismo
- https://www.santander.com.co/recursos/archivos/politicas-de-cobranza-enero-2023.pdf
- https://www.elpais.com.co/economia/tiene-uno-de-estos-creditos-la-ley-ordena-a-los-bancos-suspender-el-cobro-si-cumple-este-requisito-0858.html
