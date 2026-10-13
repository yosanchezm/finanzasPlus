# Proposal: Debt plan changes, legal rates and late interest

Users can enter rate changes, charge changes and restructures from the web and from Nia. Late interest (mora) is computed under Colombian rules. Legal rates (IBC, usury, SMMLV) become household data instead of values in code.

## Intent

| Gap today | After this change |
|---|---|
| The core supports `rate_change`, `charge_change` and `restructure`, but the web and Nia cannot create them. | "Más acciones" on the web and Nia intents, with a before/after preview and exactly-once saves. |
| Usury and SMMLV live in code, and only a deploy can update them. | The household edits them in Ajustes or through Nia, and the code tables remain the fallback. |
| `terms.lateRate` is never read, so an overdue installment costs nothing extra. | Daily mora on overdue principal, capped by the usury rate of each day. |

> Legal figures are **informational**. They warn and never block, and the bank's statement always wins.

## Decisions (owner-approved)

| # | Rule |
|---|---|
| 1 | Default mora by kind: bank loans `usury`; family and informal loans `none` (`fixed` allowed); mortgage `usury` for now, with the Ley 546 rules flagged for later. |
| 2 | Mora accrues on overdue principal only. Interest, charges, taxes and capitalized interest never accrue it (no anatocism). |
| 3 | On overdue principal, mora replaces regular interest. The two are never charged together. |
| 4 | Accrual: actual/365, simple daily rate taken from the EA, from the day after the due date (plus `graceDays`) until payment. Segments split at events, cap boundaries, rate changes and `asOf`. |
| 5 | Existing debts do not change. A dated `late_policy` event turns mora on for a debt. New debts get the default for their kind (wizard and Nia). |
| 6 | A restructure capitalizes all arrears, mora included. An optional `waiveLate` forgives the mora. |
| 7 | A household `legal_rates` table stores the IBC per month and modality. Usury = IBC × 1.5, rounded half up in basis points, unless an explicit override is set. SMMLV is stored per year. A stale cap carries forward with a warning. The tables reach the core through the `debt.legal` decoration and `opts.legal`. |
| 8 | Card mora (last slice) accrues on the principal part of the unmet minimum payment and is billed in the next statement. |
| 9 | Out of scope: collection fees (users enter them in `bankSplit.charges`) and automatic fetching of Superfinanciera data. |
| 10 | Web and Nia flows reuse `useCommitDialog`, `findSaved` and `debt:{pendingId}`. A new core `previewChange` shows the before and after. Costs are reconciled after each save. History shows a summary for these events. Rate and charge changes can be voided; a restructure can be voided only through a guarded flow. |

## Scope

### In scope

- `legal_rates` schema, `resolveLegal` and `capOn`, the notices with injected tables, and an Ajustes `LegalRatesPanel`.
- Rate change, charge change (with a `ChargesEditor`) and restructure (3 steps) on the web. Cards get only the first two.
- A mora engine inside `project()`, the `late_policy` event, mora defaults in the wizard, and mora shown in detail, payment and history.
- New Nia actions: `legal_rate`, `rate_change`, `charge_change` (edit or remove only), `restructure` and mora. `nia:conv` is generalized and a `nia:mode` callback is added.
- Card mora.

### Out of scope

- Collection fees and automatic fetching of Superfinanciera data.
- Mortgage rules under Ley 546/1999 (only flagged).
- Adding a new charge from Nia (web only).
- Editing `termsJson` in place.

## Capabilities

### New capabilities

- `legal-rate-parameters`: the `legal_rates` storage, IBC-to-usury derivation with an override, SMMLV by year, resolution with code fallback, stale carry-forward, and the Ajustes panel.
- `late-interest`: mora modes, base, window, daily accrual, cap per day, `late_policy`, defaults by kind, and the stale or unknown cap notices.

### Modified capabilities

| Capability | Change |
|---|---|
| `interest-rate-conversion` | The usury notice resolves the cap from the injected legal table. |
| `debt-ledger` | `late_policy` event; mora in outstanding, `pastDue` and allocation; restructure arrears and `waiveLate`; `previewChange`; void rules for plan changes. |
| `debt-amortization-schedule` | Plan rows expose `lateMinor`, `lateDays` and `lateBaseMinor`. |
| `debt-prepayment-advice` | The Ley 1555 notice reads SMMLV from the resolved table. |
| `debt-web-management` | "Más acciones" dialogs, history summaries, voids, reconcile after save, and mora in the wizard, detail and payment views. |
| `credit-card-debt` | Mora on the unmet minimum, billed in the next statement. |
| `nia-debt-assistant` | The new actions and callbacks, with the same exactly-once and paraphrase guardrails. |

These are delta specs against `openspec/changes/debt-management/specs/*`, because those specs are not archived yet.

## Approach

| Area | Approach |
|---|---|
| Legal rates | `resolveLegal(rows, defaults)` returns `{usuryTable, smmlvTable}`. Precedence: `opts.legal`, then `debt.legal`, then the code tables. The loaders `useDebtData.load` and Nia `loadDebts` set `debt.legal`, so none of the 13 call sites change. |
| Mora | `accrueLate` runs before each event and at `asOf`. An exact accumulator is rounded once. `rowOutstanding` includes mora, so `dueNow` and `pastDueMinor` follow without caller changes. |
| Plan changes | `previewChange(debt, events, draft, {on})` returns the before and after, plus the impacted past events. The existing `planCommit` and `commitPlan` write the event. |
| Nia restructure | The pending stores only the overrides. The terms are rebuilt from the live debt at Confirm time. |

## Affected areas

| Area | Impact |
|---|---|
| `packages/finance-core/` (legal, ledger `project`/`tail`/`events`/`rows`, card, notices) | Modified / New |
| `src/features/debts/` (`DebtDetail`, dialogs, `ChargesEditor`, `EventHistory`, `debtDetailModel`, `reconcile`) | Modified / New |
| `src/features/settings/` (Ajustes, `LegalRatesPanel`) and the shell's sidebar entry | New / Modified |
| `scripts/migrate-appwrite.mjs` | Modified: new `legal_rates` table (create-only, additive) |
| `functions/nia/debt/*` (actions, callbacks, `updateRow` seam) | Modified |

## Slice plan (stacked to main, slices ≤2000 lines, PRs ≤800)

| Slice | Content | Depends on |
|---|---|---|
| A | Legal parameters: core (A1), schema and `debt.legal` (A2), Ajustes (A3) | none |
| B | Web rate and charge change: `previewChange` and voids (B1), `RateChangeDialog` (B2), `ChargeChangeDialog` (B3) | A |
| C | Core mora: `terms.late` (C1), accrual (C2), `late_policy` and `waiveLate` (C3) | A |
| D | `RestructureDialog` (D1), mora in the UI (D2) | B, C |
| E | Nia `legal_rate` (E1), rate and charge change (E2) | A, B |
| F | Nia restructure (F1), Nia mora (F2), card mora (F3) | C, D, E |

B and C can run in parallel after A. The finished chain is fast-forwarded into `master`.

## Deploy order

1. Run `npm run migrate:appwrite` (creates `legal_rates`).
2. Deploy the web and the Nia tarball **together**.

Older code rejects unknown event kinds (`validateEvent`), so an old bundle would mark any debt with a `late_policy` event as unreadable.

## Rollback plan

- **Schema.** Additive only. `legal_rates` can stay, and the code tables apply again.
- **Code.** Revert the slices, then redeploy the previous web build and tarball together.
- **Data.** Before rolling back past C3, delete or migrate any `late_policy` events. Otherwise, make C1 ship tolerance for unknown kinds first (decided in design).
- **Restructure and plan-change events.** The pre-change core already replays them, so they are safe.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Retroactive cost drift once mora is on | Med | Default `none` for existing debts, the dated `late_policy` event, reconcile toasts |
| A stale usury table | High | Carry the cap forward, `late_cap_stale` notice, monthly prompt |
| An old bundle cannot read `late_policy` | Med | Deploy together; forward-compatible event handling |
| Stale cost rows after a backdated change from Nia | Med | A note in Nia, or move `planReconcile` into the core (design decides) |
| Voiding a restructure that has later payments | Low | Guarded void that is blocked when later payments exist |
| `Math.pow` drift at the last ulp; the 8000-character payload limit | Low | Golden tests; `payload_too_large` check |
| Legal accuracy | Med | Informational wording; the statement wins |

## Success criteria

- [ ] 199,505 overdue 10 days at 28.59% EA accrues **1,375**; 30 days accrues **4,125**.
- [ ] Paying 390,381 on day 10 splits into charges 10,000, mora 1,375, interest 180,876 and principal 198,130, with a cost row of 192,251.
- [ ] A cap that changes mid-way (illustrative 27.50%) gives 687.46 + 664.18 rounded once = **1,352**. Card: 125,000 over 10 days gives **861**. A family loan with `none` gives **0**.
- [ ] IBC 19.49 derives usury **29.24**. An override wins. Without a `legal_rates` row, the code default applies.
- [ ] Existing debts without `late_policy` project exactly as before (golden parity).
- [ ] Every plan change from the web or Nia saves exactly once, even on a retry.
- [ ] `npm test` and `npm run build` pass, and the Nia tarball deploys.

## Proposal question round (owner review)

These questions remain open. The assumptions apply until the owner answers.

1. Ley 1555 scope: does the 880 SMMLV threshold apply as currently assumed? *Assumption: yes, to be verified in specs.*
2. A backdated change made from Nia: show a "open it on the web" note, or reconcile in the core? *Assumption: show the note in E, with a core reconcile as a follow-up.*
3. Who can edit legal rates? *Assumption: any household member, audited by `actorId`.*
