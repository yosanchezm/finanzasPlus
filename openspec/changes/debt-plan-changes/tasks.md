# Tasks: Debt plan changes, legal rates and late interest

Strict TDD: in every group the `RED` task (failing Vitest test) precedes its `GREEN` task, then `REFACTOR` if needed. Core test files carry `// @vitest-environment node`. The node16 source list (`test/node16.test.js`) and the barrel exact-keys test change RED-first in every core group. Node16 rules: no `Object.hasOwn`, `.at(`, `findLast`, `toSorted`, `structuredClone`, `groupBy`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | Design estimate about 12,300 incl. tests; realistic 12,000-20,000 (past forecasts undercounted 2-2.5x) |
| Per slice (design / worst case) | A1 640/1,300 · A2 800/1,600 · A3 900/1,800 · B1 820/1,640 · B2 750/1,500 · B3 700/1,400 · C1 520/1,040 · C2 900/1,800 · C3 640/1,280 · D1 1,050/2,100 · D2 850/1,700 · E1 700/1,400 · E2 1,000/2,000 · F1 650/1,300 · F2 450/900 · F3 950/1,900 |
| 800-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | 16 stacked slices (A1..F3), each with 2-3 commit groups <=800 lines; fast-forwarded into `master` in order |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
800-line budget risk: High

Why no decision: `auto-chain` plus `stacked-to-main` are already chosen by the owner, and the open owner questions (Ley 1555 scope, Nia backdated note, who edits rates) have standing assumptions. Two items need a call from the orchestrator during apply, neither blocking: (1) `previewChange` on `installment_too_low`: spec says "return a typed error", design says it throws `ValidationError`. Tasks follow the design (throw with `code`) and ask that the spec wording be aligned at verify. (2) Spec lists `since` in `terms.late`; design does not store it. Tasks follow the design (`late_policy.effectiveOn` replaces it).

Rule for apply: after each commit group run `git diff --stat`; if a group passes 800 lines, stop and split at the next `a/b/c` marker. D1 is the only slice that can exceed 2,000 at 2x; if D1a+D1b already reach 1,400, ask for a size review before D1c.

Nia files (`functions/nia/`) are plain files tracked by this repository (the nested repo was removed in debt-management S0a). Commit them like any other path.

## Owner actions (never automated)

1. Run `npm run migrate:appwrite` (twice on dev first) BEFORE deploying A2 or later. It creates `legal_rates`.
2. Deploy A1 on BOTH web and Nia (`npm run package:nia`, upload the tar.gz) before any build that can write `late_policy` (D2 web, F2 Nia). Gate tasks: D2.0 and F2.0.
3. From C2 on, deploy the web build and the Nia tarball together every time.
4. In Ajustes (after A3): enter mortgage usury caps (there is no code default; until then `late_cap_unknown`) and the monthly IBC or usury.
5. Rollback below A1 with any `late_policy` present: delete those rows in the Appwrite console (no team delete permission).

## Suggested Work Units

| Unit | Goal | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| A1 | Forward-compatible reader + legal resolve/cap/SMMLV | `npx vitest run packages/finance-core/test/ledger/events.forward.test.js packages/finance-core/test/legal.resolve.test.js packages/finance-core/test/node16.test.js` | `npm run package:nia` | `src/ledger/{events,project}.js`, `src/legal.js`, barrel (safe: no data depends on it) |
| A2 | `legal_rates` schema, loaders decorate `debt.legal`, banners | `npx vitest run scripts packages/finance-core src/appwrite.test.js src/features/debts functions/nia/debt/handler.test.js` | `npm run migrate:appwrite` (owner, dev) | schema file + loaders; the table stays |
| A3 | Ajustes `LegalRatesPanel` | `npx vitest run src/features/settings src/app` | `npm run build` | `src/features/settings`, three nav files |
| B1 | `previewChange`, `removeCharge`, void rules, summaries | `npx vitest run packages/finance-core/test/ledger/preview.test.js src/features/debts/debtDetailModel.test.js` | `npm run build` | `snapshot.js`, `preview.js`, web model files |
| B2 | Menu + `RateChangeDialog` + afterSave reconcile | `npx vitest run src/features/debts` | `npm run build` | new dialog/menu files, `useCommitDialog.afterSave` |
| B3 | `ChargesEditor` + `ChargeChangeDialog` | `npx vitest run src/features/debts` | `npm run build` | new editor/dialog files |
| C1 | `terms.late`, `terms.modality`, daily rate | `npx vitest run packages/finance-core/test/late/policy.test.js` | `npm run package:nia` | `src/late/policy.js`, `terms.js` |
| C2 | Accrual engine inside `project()` | `npx vitest run packages/finance-core/test/late packages/finance-core/test/ledger` | `npm run package:nia` | `src/late/accrue.js`, `rows.js`, `project.js` hooks |
| C3 | `late_policy`, `waiveLate`, restructure helpers | `npx vitest run packages/finance-core/test/ledger` | `npm run package:nia` | `events.js`, `tail.js`, `restructure.js` |
| D1 | `RestructureDialog` (3 steps) + guarded void | `npx vitest run src/features/debts` | `npm run build` | new dialog/model files, menu item |
| D2 | Mora UI: wizard, detail, payment, `LatePolicyDialog` | `npx vitest run src/features/debts` | `npm run build` | UI files; core stays |
| E1 | Nia `legal_rate` | `npx vitest run functions/nia/debt` | `npm run package:nia` | `legal.js` + handler/pending wiring |
| E2 | Nia rate/charge change, `nia:mode`, `nia:conv` | `npx vitest run functions/nia/debt` | `npm run package:nia` | `planChange.js` + callbacks |
| F1 | Nia restructure | `npx vitest run functions/nia/debt` | `npm run package:nia` | `planChange.js` restructure branch |
| F2 | Nia mora + default by kind | `npx vitest run functions/nia/debt` | `npm run package:nia` | mora action in handler/extract/preview |
| F3 | Card mora, card guards, card UI | `npx vitest run packages/finance-core/test/card src/features/debts` | `npm run package:nia` + `npm run build` | `card/card.js` mora, card guards, card UI |

Slice checkpoint (last task of every slice, id `<slice>.CP`): `git diff --stat` (slice <=2000, each group <=800), `npm test -- --maxWorkers=4` (App.test.jsx lazy timeouts are known environmental flakiness: re-run that file alone before treating as a failure), `npm run build`, and `npm run package:nia` for every slice except A3, B2, B3, D1, D2.

## Phase A: Legal parameters

### A1 core compatibility and legal (design 640) · deps: none
Groups: A1a (about 250), A1b (about 390).

- [x] A1a.1 RED `packages/finance-core/test/ledger/events.forward.test.js`: unknown string kind skipped with `unknown_event_kind {eventId, kind}`; known events project as if absent; `void` of an unknown target ignored; `validateEvent` and `planCommit` still throw on unknown kind; mutation: lenient `validateEvent` must fail. Add `events.js` to node16 list. Reqs DL1.
- [x] A1a.2 GREEN `src/ledger/events.js` (`readEvents`; `sortEvents`/`activeEvents` use it), `src/ledger/project.js` (notice). Done: A1a.1 passes, parity suites unchanged.
- [x] A1b.1 RED `test/legal.resolve.test.js`: 1949 to 2924 bp, 1906 to 2859; override wins; mortgage `ibc` derives nothing; empty rows give code defaults (SMMLV 2026 = 1,750,905); `capOn` covers, carries stale with `lastValidTo`, null before first cap, never throws; `smmlvFor` carries forward; `legalOf` precedence (`opts` > `debt` > code); `resolveLegal.unavailable`; `usuryNotice` with only 2026-10 cap on 2026-12 gives `stale:true`, injected 29.00 beats 28.59, no cap gives null; `ley1555Notice` 300,000,000 within 1,540,796,400, 2,000,000,000 above, household 1,800,000 gives 1,584,000,000. Barrel exact-keys RED. Reqs LR2, LR3, LR4, LR5, LR6 (core), IR1, PA1.
- [x] A1b.2 GREEN `src/legal.js`, `index.js`, `project.js` (`legalOf` into context). Done: all pass.
- [x] A1.CP checkpoint. Gate for owner: deploy web + Nia at or after A1 (action 2).

### A2 schema and decoration (design 800) · deps: A1
Groups: A2a schema + web (about 500), A2b Nia + docs (about 300).

- [x] A2a.1 RED `scripts/lib/legal-schema.test.mjs`: columns/sizes per design, unique index `by_household_kind_modality_from`, key `by_household`, no delete permission, merge refuses collisions, `withLegalSchema` chained after `withDebtSchema`. Reqs LR1.
- [x] A2a.2 GREEN `scripts/lib/legal-schema.mjs`, `scripts/migrate-appwrite.mjs` (idempotent rerun test).
- [x] A2a.3 RED `src/appwrite.test.js`: `listLegalRates`; `upsertLegalRate` turns `409` into update with deterministic id `lr{k}{mm}{yyyymm}{hh[0..25)}`; range guards (ibc/usury 500..10000 bp, smmlv 100,000..100,000,000). RED `useDebtData` test: debts get `legal`/`legalStatus`; `404` or read failure gives defaults + `legal_rates_unavailable` banner on list and detail while debts load; `reconcile.js` skips a debt with `unknown_event_kind` (AD2); unknown-kind banner; wizard passes `{usuryTable}` and warns, never blocks (household cap 29.00 vs 29.50). Reqs LR1, LR4, LR6, DL1, DL5, WM7.
- [x] A2a.4 GREEN `src/appwrite.js`, `useDebtData.js`, `reconcile.js`, `DebtsView`/`DebtsContainer`/`DebtDetail`, `wizardModel.js`.
- [x] A2b.1 RED `functions/nia/debt/handler.test.js`, `preview.test.js`: `loadDebts` decorates `legal`; `loadLegal` survives a `404` with `unavailable` fallback; cap-citing previews append one notice line. Reqs LR4, LR6.
- [x] A2b.2 GREEN `functions/nia/debt/handler.js`, `preview.js`; docs `docs/setup.md` (migration step) and `docs/deploy.md` (deploy order).
- [x] A2.CP checkpoint.

### A3 Ajustes panel (design 900) · deps: A2
Groups: A3a nav + model + hook (about 450), A3b panel (about 450).

- [x] A3a.1 RED `legalRatesModel.test.js`: grouping by modality and month, badges (derived from IBC, manual usury, app value, unverified, stale "usando la de {mes}"), derived echo 19.49 gives 29,24, range errors disable save. RED `useLegalRates.test.js`: save then reload, missing-table state. RED shell tests: Sidebar button enabled with `aria-current`, `MoreSheet` item, `FinanceShell` `case 'Ajustes'` in `UNSCOPED_VIEWS`. Reqs LR1, LR7.
- [x] A3a.2 GREEN `src/features/settings/{legalRatesModel.js,useLegalRates.js,SettingsContainer.jsx}`; `Sidebar.jsx`, `MoreSheet.jsx`, `FinanceShell.jsx`.
- [x] A3b.1 RED `LegalRatesPanel.test.jsx` (RTL): enter IBC 19.49 shows "Usura = 29,24 % E.A." before saving; stale badge + prompt when current month has no row; SMMLV by year; invalid disables save with inline message; "Verificado" checkbox; informational copy; missing-table banner "Falta actualizar la base de datos". Reqs LR7, LR6.
- [x] A3b.2 GREEN `LegalRatesPanel.jsx`, `SettingsView.jsx`.
- [x] A3.CP checkpoint. Owner action 4 becomes possible.

## Phase B: Web rate and charge change (parallel with C after A)

### B1 preview and voids (design 820) · deps: A
Groups: B1a core (about 420), B1b web (about 400).

- [x] B1a.1 RED `packages/finance-core/test/ledger/preview.test.js`: `before`/`after` for `rate_change` cross-checked with `project`; preview equals projection after save (`keep_term`); keep_installment vs keep_term; `installment_too_low` throws `ValidationError` with `code` (design; see forecast note); `impacted` for a backdated change (payment 2026-08-05, change 2026-07-01); `payloadChars`; `removeCharge` transitive `pctOfCharge` dependents; `applyRateChange` returns `{fromEA,toEA}`; card characterization: `previewChange` rate_change on a card does not throw, and revolving rate changes while a 0% deferred tranche is unchanged. Barrel RED (`previewChange`, `removeCharge`, `normalizeCharges`). Reqs DL2, CC2.
- [x] B1a.2 GREEN `src/ledger/{snapshot,preview}.js`, `src/prepay/simulate.js` (use snapshot), `src/charges.js`, `src/ledger/tail.js`, barrel; `card/card.js` only if the card test fails.
- [x] B1b.1 RED `debtDetailModel.test.js`: `voidRuleOf` table (voidable: payment, extra_payment, charge, adjustment, rate_change, charge_change, late_policy; disbursement/void never; restructure guarded and blocked by each later payment, extra_payment, rate_change, charge_change, late_policy, restructure, returning `voidBlocked.events`). RED `eventSummary.test.js`: `Tasa: 24,00 % → 20,00 % E.A. desde 1 nov · mantiene plazo`, charges, restructure, mora strings. RED `EventHistory`/`VoidDialog` RTL: summary instead of "$ 0"; guarded variant with confirmation checkbox, names blockers, writes nothing. Reqs WM6, DL4.
- [x] B1b.2 GREEN `eventSummary.js`, `debtDetailModel.js`, `EventHistory.jsx`, `VoidDialog.jsx`.
- [x] B1.CP checkpoint.

### B2 rate change dialog (design 750) · deps: B1
Groups: B2a menu + model + afterSave (about 380), B2b dialog + wiring (about 370).

- [ ] B2a.1 RED `MoreActionsMenu.test.jsx`: item list driven by kind (card omits "Reestructurar"), `aria-haspopup`, Escape and outside click close. RED `rateChangeModel.test.js`: 2% monthly nominal echoes about 26.8% EA; `keep_installment` only French; `installment_too_low` pre-selects `keep_term` with the specified message; past date lists impacted. RED `useCommitDialog`/`useDebtData`: `afterSave` runs reconcile on fresh `listDebtEvents`, toast counts rows; void of a plan change also reconciles. Reqs WM1 (partial), WM3, WM6, DL5.
- [ ] B2a.2 GREEN `MoreActionsMenu.jsx`, `rateChangeModel.js`, `useCommitDialog.js`, `useDebtData.js`.
- [ ] B2b.1 RED `RateChangeDialog.test.jsx`: preview before save; usury notice from resolved table; installment_too_low; backdated warning; double submit writes one `rate_change`; reconcile toast "2 filas". Reqs WM3, WM6, DL2, DL5, IR1.
- [ ] B2b.2 GREEN `RateChangeDialog.jsx`, `DebtDetail.jsx`, `DebtDetailContainer.jsx`.
- [ ] B2.CP checkpoint.

### B3 charge change dialog (design 700) · deps: B2
Groups: B3a editor + model (about 380), B3b dialog + wiring (about 320).

- [ ] B3a.1 RED `chargesEditorModel.test.js`: real `Charge[]` (kind, label, basis fixed/% saldo/% original/% otro cargo/% subtotal, cadence, `fromPeriod`/`toPeriod` kept); dangling `pctOfCharge` rejected; removal lists dependents. RED `ChargesEditor.test.jsx`. Reqs WM4.
- [ ] B3a.2 GREEN `chargesEditorModel.js`, `ChargesEditor.jsx`.
- [ ] B3b.1 RED `ChargeChangeDialog.test.jsx`: 10,000 to 12,000 effective next month previews from that date only; dangling reference disables save inline; impacted payments; double submit one `charge_change`; card variant has no mode choice. Reqs WM4, DL2, WM1.
- [ ] B3b.2 GREEN `ChargeChangeDialog.jsx`, container + menu item.
- [ ] B3.CP checkpoint.

## Phase C: Core mora (parallel with B after A)

### C1 late terms (design 520) · deps: A
- [ ] C1.1 RED `test/late/policy.test.js`: `normalizeLate` per mode (`fixed` without rate and `contract_multiple` without multiple or m outside (0,3] rejected, `graceDays` integer 0..90); absent policy is `none`; `modalityOf` (mortgage, else consumer, override); `defaultLateFor` (usury for consumer, vehicle, libranza, leasing, card, mortgage; none for family, informal, other); `dailyRate(28.59)` = 0.00068917 (1e-8); `lateEAOn` cap/min logic. `terms.js` keeps `late` and `modality`. Barrel + node16 RED. Reqs LI1, LI2, LI4.
- [ ] C1.2 GREEN `src/late/policy.js`, `terms.js`, barrel.
- [ ] C1.CP checkpoint.

### C2 accrual (design 900) · deps: C1
Groups: C2a engine + rows (about 450), C2b project, goldens, properties (about 450).

- [ ] C2a.1 RED `test/late/accrue.test.js`: base = max(principal,0) − paid principal only; 199,505 x 10d = 1,375 and 30d = 4,125; grace 3 gives 7 days; cap change mid-way gives 1,352; fixed 40% above cap equals usury; `none` and 0% fixed give 0; day clock (due date + grace, payment day included); no cap gives contract EA + `late_cap_unknown`; carried cap gives `late_cap_stale`. RED `rows` tests: `rowDue().lateInterest`, `rowOutstanding` includes `lateMinor`. Reqs LI3, LI4, LI5.
- [ ] C2a.2 GREEN `src/late/accrue.js`, `ledger/rows.js`.
- [ ] C2b.1 RED fixture `late-28.59-golden.json` + `project` tests: `pastDueMinor` 391,756; pay 390,381 on day 10 gives charges 10,000 / mora 1,375 / interest 180,876 / principal 198,130, cost 192,251, 1,375 principal still overdue; 100,000 gives mora 1,375 / interest 88,625 / principal 0; 300,000 gives principal paid 107,749 and 632 after 10 more days; `lateInterestMinor` equals `totals.remainingLateInterest`; row `lateMinor`/`lateDays`/`lateBaseMinor`, zeros under `none`; bank `bankSplit.lateInterest` 5,000 under `none`; interest-only overdue gives 0; no regular interest and mora for the same days; `late_mortgage_unverified`; parity: pre-existing S3a fixtures deep-equal with new fields 0. `test/late/properties.test.js` (mulberry32, 200 loans): monotonic, <= cap bound, zero cases, +/-1 peso path independence (extra boundary on day 12). Reqs LI1, LI3-LI6, LI8, DL7, DL8, AS1.
- [ ] C2b.2 GREEN `ledger/project.js` (`lateClock`, calls before each event and at `asOf`, fields, notices, `legalOf`).
- [ ] C2.CP checkpoint. From here on: web and Nia deploy together (action 3).

### C3 policy and restructure (design 640) · deps: C2
Groups: C3a event + waive (about 400), C3b restructure helpers (about 240).

- [ ] C3a.1 RED `late_policy`: 20 days overdue with policy effective today accrues 0, 5 days later 5; latest non-voided policy applies; void restores the prior projection; second policy appends; `normalizeLate` validates payload; `previewChange` accepts a `late_policy` draft; void of `rate_change`/`charge_change` restores projection; `waiveLate` forgives mora and records `applied[].waivedLateMinor`; restructure carry with mora 391,756 and with waive 390,381; no mora on replaced rows; new terms inherit `late`. Reqs LI7, DL3, DL4, DL6.
- [ ] C3a.2 GREEN `ledger/events.js`, `project.js`, `tail.js`, `ledger/preview.js` (late_policy draft).
- [ ] C3b.1 RED `restructureCarry` breakdown and `waivableLateMinor`; `buildRestructureTerms` keeps `current.late`, rejects `firstDueOn` <= `effectiveOn`; `previewChange` restructure draft with `payloadChars` > 8000 detectable; backdated `impacted`. Barrel RED. Reqs DL2, DL3.
- [ ] C3b.2 GREEN `src/ledger/restructure.js`, `preview.js`, barrel.
- [ ] C3.CP checkpoint.

## Phase D: Web restructure and mora UI (deps: B, C)

### D1 restructure dialog (design 1,050; most likely to exceed) · deps: B3, C3
Groups: D1a model (about 350), D1b steps 1-2 (about 400), D1c step 3 + wiring (about 300).

- [ ] D1a.1 RED `fromTerms.test.js` (round-trips `projection.terms` to a valid draft) and `restructureModel.test.js`: carried balance equals breakdown sum; `firstDueOn` <= effective date inline error and no advance; "condonar mora" only when mora > 0 and excluded from carried; `payload_too_large` above 8000. Reqs WM5, DL3.
- [ ] D1a.2 GREEN `wizard/fromTerms.js`, `restructureModel.js`.
- [ ] D1b.1 RED `RestructureDialog.test.jsx` steps 1-2: arrears + mora, rate/system/periodicity/n/`firstDueOn`/grace or balloon, embedded `ChargesEditor`. Reqs WM5.
- [ ] D1b.2 GREEN `RestructureDialog.jsx` steps 1-2.
- [ ] D1c.1 RED step 3 before/after + usury notice, `payload_too_large` disables save, double submit one event, afterSave reconcile; menu shows "Reestructurar" for loans only; end-to-end guarded void blocked by a later payment names it, writes nothing; allowed when none follows. Reqs WM5, WM1, WM6, DL4, DL5.
- [ ] D1c.2 GREEN step 3, container, menu item.
- [ ] D1.CP checkpoint.

### D2 mora UI (design 850) · deps: C3, A1 deployed
Groups: D2a wizard (about 250), D2b detail + payment (about 330), D2c `LatePolicyDialog` (about 270).

- [ ] D2.0 GATE (owner): A1 is deployed on web and Nia. Do not merge D2 otherwise.
- [ ] D2a.1 RED `wizardModel`/`PlanStep` tests: mora select defaults (family none, consumer usury); `fixed` asks for a rate; default applied to the created terms. Reqs WM7, LI2.
- [ ] D2a.2 GREEN `wizardModel.js`, `PlanStep.jsx`.
- [ ] D2b.1 RED detail tests: mora KPI, Mora column when any `lateMinor > 0` (1,375, 10 days, base 199,505), totals include mora, `late_cap_stale` (with Ajustes link), `late_cap_unknown`, `late_mortgage_unverified` notices non-blocking; `paymentModel`: 390,381 at day 10 previews 10,000 / 1,375 / 180,876 / 198,130 with cost 192,251; double submit one event; history `late_policy` summary. Reqs WM8, WM9, DL8, AS1.
- [ ] D2b.2 GREEN `DebtDetail.jsx`, `PlanTable.jsx`, `paymentModel.js`, `PaymentDialog.jsx`, `eventSummary.js`.
- [ ] D2c.1 RED `LatePolicyDialog.test.jsx`: effective 10 days ago previews and saves mora 1,375 with one `late_policy`; effective today shows 0 and keeps cost rows; stale notice when table does not cover today; `contract_multiple` input (0<m<=3); `graceDays`; past-date warning; reconcile afterSave. Reqs WM2, LI7.
- [ ] D2c.2 GREEN `LatePolicyDialog.jsx`, `MoreActionsMenu.jsx` (loans), container.
- [ ] D2.CP checkpoint.

## Phase E: Nia legal rate and plan changes (deps: A, B)

### E1 Nia `legal_rate` (design 700) · deps: A2
Groups: E1a `legal.js` + extraction (about 350), E1b handler/pending/seam (about 350).

- [ ] E1a.1 RED `functions/nia/debt/legal.test.js`, `extract.test.js`: "la usura de noviembre es 28.2" gives usury 28.20 `consumer` 2026-11; month without year resolves within +/-6 months; 2.82 refused; preview echoes kind, modality, month, value; LLM extracts phrase only. Reqs NI1, NI6.
- [ ] E1a.2 GREEN `functions/nia/debt/legal.js`, `extract.js`.
- [ ] E1b.1 RED `handler.test.js`, `pending.test.js`, wiring test: Confirm writes once; second Confirm one row; existing row updates and is reported as update (409 then `deps.updateRow`); nothing written before Confirm; pending <= 1.5 KB; `DEBT_ROW_ACTIONS.legal_rates = ['read','update']` and `PATCH /rows/{id}` seam. Reqs NI1, NI6, NI8.
- [ ] E1b.2 GREEN `handler.js`, `pending.js`, `index.js`.
- [ ] E1.CP checkpoint.

### E2 Nia rate and charge change (design 1,000) · deps: E1, B1
Groups: E2a rate change (about 350), E2b callbacks (about 300), E2c charge change + note (about 350).

- [ ] E2a.1 RED `planChange.test.js`, `extract.test.js`: `planChange{effectiveOn, mode, newValue, ...}` extraction; effective date default today; preview EA echo, household-cap usury notice (cap 29.00, 30% EA); `installment_too_low` explained with `keep_term` offered; cards skip mode. Reqs NI2, NI7.
- [ ] E2a.2 GREEN `functions/nia/debt/planChange.js`, `extract.js`, `preview.js`.
- [ ] E2b.1 RED `pending.test.js`: `nia:mode:keep_term`/`keep_installment` <= 25 bytes, `keep_installment` only French; `nia:conv:*` routed by `CONVENTION_NEXT[pending.action]`; stale button ignored with message and no write; event id `de{id}`, key `debt:{id}`, done marker answers "ya estaba registrado"; double Confirm one event; pending <= 1.5 KB. Reqs NI5, NI8, NI2.
- [ ] E2b.2 GREEN `pending.js` (`modeKeyboard`, `parseCallback`), `handler.js` (`CONVENTION_NEXT`).
- [ ] E2c.1 RED charge change: match by label/kind ignoring case and accents; remove "seguro de vida" previews removal and new installment; adding refused with web pointer; backdated note when `impacted.length > 0`; charges rebuilt from live debt at Confirm. Reqs NI2, NI6.
- [ ] E2c.2 GREEN `planChange.js`, `handler.js`, `preview.js`.
- [ ] E2.CP checkpoint.

## Phase F: Nia restructure, Nia mora, card mora (deps: C, D, E)

### F1 Nia restructure (design 650) · deps: E2, C3
Groups: F1a rebuild (about 330), F1b handler (about 320).

- [ ] F1a.1 RED `planChange.test.js`: pending stores overrides only (<= 1.5 KB); terms rebuilt from the live debt at Confirm so a payment between preview and Confirm changes the written carried balance; invalid terms, unreadable event, or payload > 8000 write nothing and explain; `waiveLate`. Reqs NI3.
- [ ] F1a.2 GREEN `planChange.js`, `extract.js`.
- [ ] F1b.1 RED `handler.test.js`: "reestructura a 48 cuotas, primera cuota 2026-12-05" previews arrears, carried balance, new installment, usury notice; Confirm writes one `restructure`; double Confirm one; cards refused. Reqs NI3, NI6, NI7, NI8.
- [ ] F1b.2 GREEN `handler.js`, `preview.js`.
- [ ] F1.CP checkpoint.

### F2 Nia mora (design 450) · deps: C3, D2, A1 deployed on Nia
- [ ] F2.0 GATE (owner): Nia tarball at or after A1 is deployed. Do not deploy F2 otherwise.
- [ ] F2.1 RED `extract.test.js`, `handler.test.js`, `preview.test.js`, `replies.test.js`: "activa mora a la usura" previews mode `usury`, today, cap in force, "la mora no es retroactiva", Confirm writes one `late_policy`; fixed 40% vs cap 28.59 states 28.59 applies; all four modes including `contract_multiple`; creating a debt applies the default by kind; list replies show mora; double Confirm one event. Reqs NI4, NI6, NI8, LI2.
- [ ] F2.2 GREEN `extract.js`, `handler.js`, `preview.js`, `replies.js`.
- [ ] F2.CP checkpoint.

### F3 card mora (design 950) · deps: C3, D2
Groups: F3a engine + guards (about 480), F3b card UI (about 470).

- [ ] F3a.1 RED `card` tests: 125,000 unmet principal x 10 days gives 861, billed at next statement close; stops at close or when covered; no revolving interest on unmet principal; minimum paid gives none and not past due; `none` gives no mora but flagged past due; `adjustment.lateInterestMinor` 900 overrides 861; `late_policy` handler; `planCommit`/`previewChange` throw `ValidationError('restructure_unsupported')`; stored card `restructure` skipped with `card_restructure_ignored`. Reqs CC1, CC2.
- [ ] F3a.2 GREEN `card/card.js`, `ledger/events.js`, `ledger/commit.js`, `ledger/preview.js`.
- [ ] F3b.1 RED UI tests: `StatementDialog` stated mora field; `CardPanel` mora line; card wizard default usury; card menu lists "Cambiar tasa", "Cambiar seguros y cargos", "Configurar mora", no "Reestructurar"; `LatePolicyDialog` card variant. Reqs CC1, WM1, WM2, LI2.
- [ ] F3b.2 GREEN `cardWizardModel`, `CardStep`, `CardDialogs.jsx`, `CardPanel`, `MoreActionsMenu.jsx`, `LatePolicyDialog.jsx`.
- [ ] F3.CP final checkpoint: full `npm test -- --maxWorkers=4`, `npm run build`, `npm run package:nia`; update `docs/deploy.md` if flow changed.

## Requirement to task traceability

| Req | Tasks | Req | Tasks |
|---|---|---|---|
| LR1 storage | A2a.1-3, A3a | WM1 menu | B2a, B3b, D1c, F3b |
| LR2 derivation | A1b | WM2 late dialog | D2c, F3b |
| LR3 SMMLV | A1b | WM3 rate dialog | B2a, B2b |
| LR4 precedence | A1b, A2a, A2b | WM4 charge dialog | B3a, B3b |
| LR5 cap lookup | A1b | WM5 restructure dialog | D1a-D1c |
| LR6 unavailable | A1b, A2a, A2b, A3b | WM6 history/void | B1b, B2, D1c |
| LR7 Ajustes | A3a, A3b | WM7 wizard (M) | A2a, D2a |
| LI1 modes | C1, C2b | WM8 detail (M) | D2b |
| LI2 defaults | C1, D2a, F2, F3b | WM9 payment (M) | D2b |
| LI3 base | C2a, C2b | NI1 legal_rate | E1a, E1b |
| LI4 window/rate | C1, C2a | NI2 rate/charge | E2a, E2c |
| LI5 cap per day | C2a | NI3 restructure | F1a, F1b |
| LI6 projection | C2b | NI4 mora | F2 |
| LI7 late_policy | C3a, D2c | NI5 callbacks | E2b |
| LI8 invariants | C2b | NI6 intent (M) | E1, E2, F1, F2 |
| DL1 forward compat | A1a, A2a | NI7 echo (M) | E2a, F1b |
| DL2 preview | B1a, B2b, C3a, C3b | NI8 exactly-once (M) | E1b, E2b, F1b, F2 |
| DL3 restructure | C3a, C3b, D1 | CC1 card mora | F3a, F3b |
| DL4 void rules | B1b, C3a, D1c | CC2 card plan changes | B1a, F3a |
| DL5 cost rows | A2a, B2, D1c | IR1 usury notice (M) | A1b, B2b |
| DL6 append-only (M) | C3a | AS1 cost summary (M) | C2a, C2b, D2b |
| DL7 allocation (M) | C2b | PA1 Ley 1555 (M) | A1b |
| DL8 cost row (M) | C2b, D2b | | |

All 45 ADDED/MODIFIED requirements are covered.

## Key Learnings

1. Treating each design slice (A1..F3) as the apply unit and adding `a/b/c` commit groups keeps every PR at or below 800 lines even when tests double the forecast.
2. The spec and design disagree on whether `previewChange` returns or throws on `installment_too_low`, so tasks follow the design and flag the spec wording for verify.
3. The deploy gates (A1 on web and Nia before D2 and F2) are encoded as explicit owner gate tasks, because code order alone cannot protect older bundles from `late_policy` events.
4. Nia code is tracked in the main repository, so its commit groups count toward the same slice budgets.
5. A card `rate_change` through `previewChange` is not covered by the design file map, so a characterization test in B1a guards against an unplanned `card.js` change.
