```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:b8e18051b832e9bb82837e616928f2bcb4affa23742cb7092a5f0e804103ca8e
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 45/45
scenarios: 132/132
test_command: npm test -- --maxWorkers=4
test_exit_code: 0
test_output_hash: sha256:1da3fb5215e1d505dee1af2a47d4fb6be0d6b3c3edcecbaa556ae5dd012ee58b
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:b73c629b3565f8bc9b18b70354a2f92025544fdfdc15ede8b099ca513a3da8b0
```

## Verification Report

**Change**: debt-plan-changes (slices A1 to F3 plus the Nia card mora follow-up)
**Version**: N/A (9 spec files: 2 new capabilities, 7 deltas)
**Mode**: Strict TDD (runner: vitest 5.0.4, `npm test`)
**Revision verified**: master 84a6a52c8f2d8fd72b829cf1b4f0a15d422b18d5 (scope `061be51^..master`: 59 commits, 172 files, +19,002 / -262)
**Date**: 2026-10-15

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 86 |
| Tasks complete | 86 |
| Tasks incomplete | 0 |
| Owner gates | D2.0 and F2.0 are `[x]`, confirmed 2026-10-15 (web redeployed from cb09a35, migration run, Nia tarball from cb09a35) |
| Requirements (ADDED + MODIFIED) | 45 (matches "All 45" in tasks.md) |
| Scenarios | 132 |

### Build and Tests Execution

**Tests**: PASS. `npm test -- --maxWorkers=4` exit 0: **124 test files passed (124), 2004 tests passed (2004), 0 failed, 0 skipped**, 72.5 s. First run, no rerun needed (the known `App.test.jsx` jsdom timeout did not appear).
**Build**: PASS. `npm run build` exit 0 (Vite, built in 976 ms).
**Nia package**: PASS. `npm run package:nia` exit 0 (`functions/nia.tar.gz` written, git-ignored by `functions/*.tar.gz`; the packager scans the bundle for APIs missing from Node 16 and did not throw).
**Coverage**: not available (no coverage tool configured). Linter, type checker and formatter: not available.

Baseline for reference: apply-progress F3.CP recorded 124 files / 1,997 tests; the Nia card follow-up added 7 tests = 2004. Matches exactly.

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD evidence reported | PASS | 17 "TDD Cycle Evidence" tables in apply-progress.md (16 slices + the Nia card follow-up) |
| All tasks have tests | PASS | every RED task names test files; all 88 test files referenced in apply-progress and tasks exist in the repo |
| RED confirmed (tests exist) | PASS | 88/88 referenced files verified present |
| GREEN confirmed (tests pass) | PASS | full suite 2004/2004 passes now |
| Triangulation adequate | PASS | goldens triangulated (10 and 30 days, 5 and 7 days, partial payments, 200-loan property tests); mutation checks recorded in the evidence tables (lenient `validateEvent`, removed interest exclusion, removed `refreshLate`) |
| Safety net for modified files | PASS (reported) | per-slice baselines recorded (for example F3: `packages/finance-core` 559 to 576, `src/features/debts` 521 to 538) |

**TDD Compliance**: 6/6 checks passed.

### Test Layer Distribution (71 test files added or modified by the change)

| Layer | Tests (approx., `it`/`test` calls) | Files | Tools |
|-------|-----------|-------|-------|
| Unit (pure core, models, Nia handlers with fakes) | ~1,006 | 45 | vitest (`// @vitest-environment node` in core) |
| Integration (RTL + user-event, containers) | ~333 | 26 | @testing-library/react, user-event |
| E2E | 0 | 0 | not installed |
| Total in suite | 2004 (`it.each` expands) | 124 | |

### Assertion Quality

Scanned all 71 added or modified test files.

| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| `src/features/debts/rateChangeModel.test.js` | 118, 130, 147 | `expect(x.draft).not.toBeNull()` | Type-only, but each case also asserts preview or draft values elsewhere | SUGGESTION |
| `src/features/debts/restructureModel.test.js` | 158, 163 | `expect(...issues.firstDueOn / .n).toBeTruthy()` | Truthy-only on an issue message; sibling cases assert `ok:false` and no advance | SUGGESTION |

- No tautologies, no assertions without a production call, no CSS-class assertions.
- Loops over collections are guarded: `late/properties.test.js` counts positives (`positive > 150`, `interestOnly.length > 30`) so a loop cannot pass vacuously.
- Mock-heavy files: none (one `vi.mock('appwrite')` per file against 24 to 204 `expect` calls).
- Empty-collection assertions (125 uses of `toEqual([])` or `toHaveLength(0)`) all have companion non-empty cases in the same suites (spot-checked: unknown-kind, `impacted`, notices).

**Assertion quality**: 0 CRITICAL, 0 WARNING, 2 SUGGESTION.

### Spec Compliance Matrix (45 requirements, 132 scenarios)

Status key: COMPLIANT = a covering test exists and passed in the run above; COMPLIANT (wording) = a covering test passed and checks the built behavior, but the spec wording and the built behavior differ and the difference is recorded as a WARNING (see Issues); no scenario is untested or failing.

**late-interest (8 requirements, 22 scenarios)**

| Requirement | Scenarios | Covering tests | Result |
|---|---|---|---|
| Mora policy and modes | Absent policy; Invalid policy; Bank-reported mora under none | `late/policy.test.js` (normalizeLate absent, fixed, multiple, grace); `ledger/project.late.test.js` "under none, mora stated by the bank still counts" | 3/3 COMPLIANT |
| Defaults by kind | Bank loan; Family; Existing untouched | `policy.test.js > defaultLateFor`; `wizardModel.test.js > mora policy in the wizard`; Nia `handler.test.js > create: mora default by kind (F2)`; `project.parity.test.js` | 3/3 COMPLIANT |
| Accrual base excludes interest | Only principal; Partial payment lowers base | `accrue.test.js > base` (charges and interest never enter; 91,756 left accrues 632) | 2/2 COMPLIANT |
| Window and daily rate | 10 days = 1,375; 30 days = 4,125; Grace 3 = 7 days | `accrue.test.js` goldens; `project.late.test.js` fixture cases | 3/3 COMPLIANT |
| Cap applies per day | Cap changes mid-way (1,352); Fixed above cap; Stale cap | `accrue.test.js` (27.50 split rounds once to 1,352; fixed 40% equals usury; `late_cap_stale`); `project.late.test.js > notices` | 3/3 COMPLIANT |
| Projection exposes mora | Past due 391,756; Pay on day 10; Short payment; Larger payment (632) | `project.late.test.js` fixture cases (`late-28.59-golden.json`): pastDue 391,756; split 10,000 / 1,375 / 180,876 / 198,130; cost 192,251; 100,000 split; 107,749 then 632 | 4/4 COMPLIANT |
| late_policy event | No retroactive mora; Void | `project.policy.test.js` (policy today accrues 0, five days later 5; void equals the projection without it) | 2/2 COMPLIANT |
| Mora invariants | Path independence; Golden parity | `late/properties.test.js` (200 seeded loans, day-12 boundary within 1 peso); `project.parity.test.js` | 2/2 COMPLIANT |

**legal-rate-parameters (7 requirements, 18 scenarios)**

| Requirement | Scenarios | Covering tests | Result |
|---|---|---|---|
| Household legal rates storage | Save twice; Out-of-range; Migration rerun | `appwrite.test.js` (409 becomes update with the last saver as actorId; range 500..10000 bp and SMMLV guards); `scripts/lib/legal-schema.test.mjs`; the rerun is checked statically only (the test is never executed against Appwrite; the owner ran the live migration) | 3/3 COMPLIANT (rerun proven statically, W7) |
| Usury derivation with override | Derivation 29.24; Rounding half up (28.59); Override wins; Mortgage not derived | `legal.resolve.test.js > resolveLegal: derivation and override`, `usuryFromIbcBp` | 4/4 COMPLIANT |
| SMMLV by year | Default 1,750,905; Household wins | `legal.resolve.test.js > resolveLegal defaults`, `smmlvFor` | 2/2 COMPLIANT |
| Resolution and precedence | Household beats code; Option beats decoration; Code fallback | `legal.resolve.test.js > legalOf` (27.50 beats 29.00 beats 28.59) | 3/3 COMPLIANT |
| Cap lookup with stale carry-forward | Stale carry-forward; Before any known cap | `legal.resolve.test.js > capOn` | 2/2 COMPLIANT |
| Legal tables unavailable | Missing table | `useDebtData.test.jsx` (404 gives `missing`, other failure `unavailable`, debts still load); `DebtDetail.test.jsx` and `DebtsView.test.jsx` banners; Nia `handler.test.js > household legal rates (A2)` | 1/1 COMPLIANT |
| Ajustes legal rates panel | Enter an IBC; Stale warning; Informational only | `LegalRatesPanel.test.jsx` (derived echo before saving, stale badge and prompt), `legalRatesModel.test.js` (29,24 from 19,49), `DebtWizard.test.jsx` (warns, never blocks) | 3/3 COMPLIANT (badge uses `verified`, see W5) |

**debt-ledger (8 requirements, 23 scenarios)**

| Requirement | Scenarios | Covering tests | Result |
|---|---|---|---|
| Forward-compatible event handling | Bundle older than data; Unknown kind on write | `events.forward.test.js` (skip with one notice per event, void of unknown ignored, card projector, strict `validateEvent` and `planCommit`) | 2/2 COMPLIANT |
| Plan change preview | Preview equals saved; Installment too low; Backdated | `preview.test.js` (equals projection after save, `keep_installment` vs `keep_term`, `impacted` with cost before and after); installment_too_low THROWS `ValidationError` | 3/3 COMPLIANT (installment_too_low is thrown, not returned, W1) |
| Restructure capitalizes arrears | Arrears capitalized (391,756); Waive mora (390,381) | `project.policy.test.js > restructure: waiveLate` (`refinancedMinor` 391,756 and 390,381), `restructure.test.js` (`carriedMinor` 10,192,251 = balance + arrears) | 2/2 COMPLIANT (wording, W2: figures asserted under `refinancedMinor`; `carriedMinor` is the whole balance) |
| Void rules for plan-change events | Void a rate change; Restructure with later payments; Restructure without later events | `project.policy.test.js` (void of rate or charge change restores the projection); `debtDetailModel.test.js > voidRuleOf` (blocked by each later kind); `DebtDetailContainer.test.jsx` (blocked void names the payment and writes nothing; allowed void writes one `void`) | 3/3 COMPLIANT |
| Cost rows follow plan changes | Backdated rate change; Reconcile twice | `reconcile.test.js`, `useDebtData.test.jsx > reconcileCosts` (create, update, delete, then no-op); `DebtDetailContainer.test.jsx` (fresh-events reconcile after rate change, charge change, restructure, late policy, void) | 2/2 COMPLIANT |
| Append-only debts and events (M) | Correction by void; Family loan without plan; Late policy append-only | `events.test.js`, `project.test.js`, `project.policy.test.js > a second policy is appended` | 3/3 COMPLIANT |
| Payment allocation (M) | Short payment; Exact; Mora paid before interest; Installment paid late | `allocate.test.js`, `project.late.test.js` fixture cases | 4/4 COMPLIANT |
| Cost-only expense rows (M) | Cost row amount; Includes mora (192,251); Retry exactly once; Atomic or reconcilable | `commit.test.js`, `DebtDetailContainer.test.jsx > mora` (one event and one 192,251 row on double tap) | 4/4 COMPLIANT |

**credit-card-debt (2 requirements, 6 scenarios)**

| Requirement | Scenarios | Covering tests | Result |
|---|---|---|---|
| Card mora on the unmet minimum | Unmet principal (861); Minimum paid; Mora off; Statement adjustment (900) | `card/card.late.test.js` (861 billed at next close, stops at close or when covered, no revolving interest on unmet capital, `none` flagged past due, override 900 with drift 39); `DebtDetailContainer.card.test.jsx` | 4/4 COMPLIANT |
| Plan changes on cards | Rate change leaves tranches; Restructure rejected | `preview.test.js > previewChange on a card (CC2)` (0% tranche untouched); `card.late.test.js > restructure_unsupported` from `planCommit` and `previewChange`, stored card restructure skipped with `card_restructure_ignored` | 2/2 COMPLIANT |

**debt-amortization-schedule (1 requirement, 3 scenarios)**: Totals reconcile (existing `schedule.*.test.js`); Overdue row with mora (`project.late.test.js` row1 `lateMinor` 1375, `lateDays` 10, `lateBaseMinor` 199505, installment unchanged); Mora off (`project.late.test.js`, mode none). 3/3 COMPLIANT.

**debt-prepayment-advice (1 requirement, 4 scenarios)**: Mortgage; Threshold 1,540,796,400 within; Above threshold; Household SMMLV 1,584,000,000. `legal.resolve.test.js > ley1555Notice threshold` and the advice tests. 4/4 COMPLIANT.

**interest-rate-conversion (1 requirement, 4 scenarios)**: Above cap; No cap data; Injected table wins (29.00 beats 28.59); Stale cap (`stale: true`, `lastValidTo`). `legal.resolve.test.js > usuryNotice`, `legal.test.js`, `wizardModel.test.js > household legal tables`, Nia `planChange.test.js` (household 29.00 on a 30% rate change). 4/4 COMPLIANT.

**debt-web-management (9 requirements, 29 scenarios)**

| Requirement | Scenarios | Covering tests | Result |
|---|---|---|---|
| More-actions menu | Loan menu; Card menu | `MoreActionsMenu.test.jsx`; `DebtDetailContainer.card.test.jsx` (card lists three items, never the restructure item) | 2/2 COMPLIANT |
| Late policy dialog | Enable usury (1,375, one `late_policy`); Effective today (0) | `LatePolicyDialog.test.jsx`, `DebtDetailContainer.test.jsx > late policy flow` | 2/2 COMPLIANT |
| Rate change dialog | Preview before save; Installment too low; Backdated; Double submit | `RateChangeDialog.test.jsx`, `rateChangeModel.test.js`, `DebtDetailContainer.test.jsx > rate change flow` | 4/4 COMPLIANT |
| Charge change dialog | Replace charges; Dangling reference | `chargesEditorModel.test.js`, `ChargeChangeDialog.test.jsx`, container flow | 2/2 COMPLIANT |
| Restructure dialog | Three steps; First due date; Payload too large; Waive mora | `RestructureDialog.test.jsx`, `restructureModel.test.js`, `fromTerms.test.js` | 4/4 COMPLIANT |
| Plan-change history and void | Summary; Blocked restructure void; Reconcile toast (2 rows) | `eventSummary.test.js`, `EventHistory.test.jsx`, `VoidDialog.test.jsx`, `DebtDetailContainer.test.jsx` | 3/3 COMPLIANT |
| Create wizard (M) | Rate echo; Interest-free plan; Validation; Mora default; Household cap used | `wizardModel.test.js`, `DebtWizard.test.jsx` (cards: default only, W3) | 5/5 COMPLIANT (loan wizard) |
| Detail and plan (M) | Schedule markers; Overdue with mora; Stale cap notice | `PlanTable.test.jsx` (Mora column 1,375 / 10 days / base 199,505), `DebtDetail.test.jsx`, `debtDetailModel.test.js` | 3/3 COMPLIANT |
| Record payment (M) | Preview matches saved; Preview with mora; Double submit; Void | `PaymentDialog.test.jsx > with mora`, `DebtDetailContainer.test.jsx` | 4/4 COMPLIANT |

**nia-debt-assistant (8 requirements, 23 scenarios)**

| Requirement | Scenarios | Covering tests | Result |
|---|---|---|---|
| Legal rate action | New value; Existing row (409 then update); Out of range | `legal.test.js`, `handler.test.js > legal_rate (E1)` | 3/3 COMPLIANT |
| Rate and charge change actions | Rate change with mode; Remove a charge; Add a charge refused; Backdated note | `planChange.test.js`, `handler.test.js > rate_change (E2)` and `charge_change (E2)` | 4/4 COMPLIANT |
| Restructure action | Preview and confirm; Debt changed before Confirm; Card refused | `planChange.test.js > rebuildRestructure`, `handler.test.js > restructure (F1)` | 3/3 COMPLIANT |
| Mora action | Enable mora; Fixed rate above the cap | `late.test.js`, `handler.test.js > late_policy (F2)` (all four modes; card variant 861) | 2/2 COMPLIANT |
| Conversation callbacks | Convention on rate change; Stale button | `pending.test.js > plan change callbacks`, `handler.test.js > stale buttons` | 2/2 COMPLIANT |
| Debt intent, extraction only (M) | Pay request; Invalid extraction; New action needs confirmation | `extract.test.js`, `handler.test.js` | 3/3 COMPLIANT |
| Rate convention echo (M) | Ambiguous rate; Echo; Household cap in notice | `handler.test.js`, `planChange.test.js` | 3/3 COMPLIANT |
| Exactly-once confirmation (M) | Double tap; Strategy needed; Plan change retry | `handler.test.js` (second Confirm answers already recorded; one event on double tap and on a race for rate change, charge change, restructure and late policy), `pending.test.js` (pending <= 1.5 KB) | 3/3 COMPLIANT |

**Compliance summary**: 132/132 scenarios have a covering test that passed; 0 UNTESTED, 0 FAILING. 4 of them (Migration rerun, Installment too low, Arrears capitalized with mora, Waive mora) carry a spec-wording WARNING (W7, W1, W2) because the spec text and the built behavior differ, not because behavior is unverified. 45/45 requirements are implemented and covered.

### Golden numbers (all asserted in passing tests)

| Number | Where asserted |
|---|---|
| 1,375 (199,505 x 10 d) | `accrue.test.js`, `project.late.test.js` fixture, `LatePolicyDialog.test.jsx`, Nia `late.test.js` |
| 4,125 (30 d) | `accrue.test.js`, fixture case thirty days overdue |
| 192,251 cost | fixture case, `PaymentDialog.test.jsx`, `DebtDetailContainer.test.jsx` (one 192,251 row on double tap) |
| 632 (300,000 then 10 d) | fixture case 300,000 on day 10 and 10 more days |
| 1,352 (mid-way cap) | `accrue.test.js > a cap change mid-way` |
| 29.24 from IBC 19.49 | `legal.resolve.test.js`, `legalRatesModel.test.js`, `LegalRatesPanel.test.jsx` |
| 391,756 / 390,381 | fixture pastDue; `project.policy.test.js` restructure (`refinancedMinor`); Nia `handler.test.js` restructure (F1) |
| 861 (card) | `card.late.test.js`, `DebtDetailContainer.card.test.jsx`, Nia `late.test.js` and `handler.test.js` |
| 1,540,796,400 / 1,584,000,000 | `legal.resolve.test.js > ley1555Notice` |
| 0.00068917 daily rate | `policy.test.js > dailyRate`, fixture |

### Design Coherence

| Decision | Followed? | Notes |
|---|---|---|
| AD1 forward compatibility: lenient readers, strict writer | Yes | `readEvents` in `events.js`; `sortEvents`, `activeEvents`, `project` use it; `validateEvent` and `planCommit` stay strict; only a string kind outside `EVENT_KINDS` is tolerated; `unknown_event_kind {eventId, kind}` per skipped event; void of an unknown event ignored; card projector covered |
| AD2 reconcile skipped on unknown kind | Yes | `reconcile.test.js > events from a newer app version` |
| AD3 basis points, half up | Yes | `usuryFromIbcBp = floor((bp*3+1)/2)`; 1949 to 2924, 1906 to 2859 |
| AD4 override, then IBC x 1.5, then default; mortgage never from IBC | Yes | `usuryEntries` excludes mortgage `ibc` rows from derivation |
| AD5 deterministic row id and shared `legalRateId` | Yes | `legalRateId` lives in the core (barrel); `src/appwrite.js` wraps it, the Nia handler imports it; 409 becomes update on both surfaces |
| AD6 `legalOf` precedence opts, debt, code | Yes | tested; loaders decorate on web (`useDebtData`) and Nia (`loadDebts`); `resolveLegal.unavailable` fallback |
| AD7 `usuryNotice` through `capOn` with stale flag | Yes | `stale` and `lastValidTo` on the notice |
| `capOn`: stale carry-forward, null before first cap, never throws | Yes | covering entry, else latest earlier with `stale:true`, else `null` |
| AD8 `previewChange` replays `project` with and without the candidate | Yes | `snapshot` extracted to `ledger/snapshot.js`; measured at max(on, effectiveOn) so the preview equals the saved projection |
| AD9 mora inside `projectLoan`, single rounding | Yes | `accrueLate` before each event and at `asOf`; exact accumulator `row.late.exact`, `roundUnit` once |
| AD10 `expm1/log1p` daily rate | Equivalent | uses `(1+EA)**(1/365)-1`, the spec formula; same 0.00068917 and goldens (S1) |
| AD11 day clock | Yes | day t accrues when t is after dueOn + grace; the payment day counts; a policy dated today accrues from tomorrow |
| Mora base is overdue principal only and replaces corriente | Yes | base is `rowDue(row).principal`; interest, charges, taxes never enter; rows bill interest only for their own period, tested (remainingInterest unchanged between 10 and 30 days) |
| Mora EA = min(policy, cap per day); `late_cap_stale`, `late_cap_unknown` | Yes | `lateEAOn`, `cutPoints` at cap boundaries |
| AD12 `late_policy` event; `waiveLate` on restructure | Yes | `waiveLate` stored only when true so older payloads stay byte-identical |
| Restructure inherits the mora policy; `waiveLate` forgives with no cost row | Yes | `waivedLateMinor` in `applied[]`; no mora on replaced rows |
| AD13 and AD14 terms rebuilt from the live debt at Confirm | Yes | `rebuildRestructure` and `rebuildCharges`; pending <= 1.5 KB tested; invalid, unreadable or over 8000 chars write nothing |
| AD16 reconcile on fresh events after every plan-change or void save | Yes | `useCommitDialog({afterSave})`; `reconcileCosts(id, {fresh:true})` re-lists events |
| Exactly-once, web | Yes | `useCommitDialog` nonce plus `findSaved`; one event on double submit tested for every dialog |
| Exactly-once, Nia | Yes | event id `de{id}`, key `debt:{pendingId}`, dedupe lookup before any rebuild, done marker answers already recorded |
| AD17 no new UI dependency | Yes | `MoreActionsMenu` is a disclosure menu, no new package |
| Card mora: unmet capital of the minimum, billed at next close, statement override, restructure guard | Yes | `card/late.js` reuses `accrueLate`; billed `lateInterest` line outside the revolving base; `adjustment.lateInterestMinor`; `assertRestructurable` and `card_restructure_ignored` |
| Card revolving-interest exclusion | Yes, refined | prorated by `baseDays / cycleDays` (second statement interest 10,392 to 9,526), see W4 |
| Node16 safety, core | Yes | `test/node16.test.js` scans every non-test `.js` under the core (new files are covered automatically): no `Object.hasOwn`, `.at(`, `findLast`, `toSorted`, `structuredClone`, `groupBy`; barrel exact-keys test updated; a repo-wide grep of the core and `functions/nia/debt` found none |
| Node16 safety, Nia bundle | Yes | `npm run package:nia` passed its forbidden-API scan. Pre-existing `.at(-1)` and `replaceAll` in `functions/nia/index.js` predate this change (commit de7b7cd) and are allowed by the packager (Node 16.6 and later) |
| Schema: additive `legal_rates`, unique key, no delete | Yes | `legal-schema.test.mjs`; migration chained after `withDebtSchema`; docs/setup.md and docs/deploy.md updated |

### Issues Found

**CRITICAL**: None.

**WARNING** (documented deviations, none blocks archive; classification in brackets)

- **W1 [acceptable-documented, spec text to align at archive]** `previewChange` throws `ValidationError` with code `installment_too_low` (design) instead of returning a typed error (spec debt-ledger Plan change preview, scenario Installment too low). Every consumer handles the typed code (the web `RateChangeDialog` pre-selects `keep_term` with the specified message; Nia explains and offers `keep_term`) and nothing is written. The fix belongs in the spec text, not the code.
- **W2 [acceptable-documented, spec text to align at archive]** Spec Restructure capitalizes arrears says the carried balance is 391,756 (390,381 with `waiveLate`). The built `carriedMinor` is 10,192,251 (10,190,876 waived) because it correctly includes the principal still to come; 391,756 and 390,381 are the refinanced arrears of the overdue installment (`plan[0].refinancedMinor`, and the refinanced-installments line in Nia and the dialog). Both figures are asserted. The scenario wording is ambiguous; the built behavior is the safe reading (otherwise the remaining principal would vanish).
- **W3 [acceptable-documented, owner awareness]** The card wizard has no mora control: a new card starts with mode usury and the step carries one sentence pointing to Mas acciones. Spec Create wizard says the wizard MUST collect the mora policy; for loans it does, for cards only the default applies. A card can change it right after creation (Configurar mora is wired for cards).
- **W4 [acceptable-documented, confirm with owner]** The card revolving-interest exclusion is prorated by `baseDays / cycleDays` and excludes the whole unmet capital (which can include installment principal that never earned revolving interest), capped at the revolving base. With the fixture the second statement interest drops from 10,392 to 9,526. It is the literal design reading and consistent with approximate and informational in the spec, but it can slightly under-bill revolving interest when the capital part of the minimum contains 0% tranche installments.
- **W5 [acceptable-documented, spec text to align]** Spec LR7 defines unverified as an empty `source`; design and implementation use the `verified` boolean column (Sin verificar badge, Verificado checkbox). Also: the spec column list omits `verified`; `terms.late.since` is not stored (replaced by `late_policy.effectiveOn`); `ley1555Notice` takes the SMMLV of the `asOf` year as the spec says while the design text says `openedOn` (the code follows the spec; fix the design text).
- **W6 [needs-fix, small, non-blocking]** B2: for a credit card, the Cambiar tasa dialog header and initial rate come from `projection.terms.rate`, which for the card projector is the ORIGINAL rate. After a card `rate_change` the dialog shows a stale Tasa actual. The before and after preview is correct (the core replays the event), so no wrong figure is saved, but the label can mislead. The same limit for charges was solved with `chargesInForce`; the rate was not. Suggested fix: derive the rate in force from the active card `rate_change` events (or expose it on the card projection) and add a test.
- **W7 [informational]** Scenario Migration rerun is proven statically (`legal-schema.test.mjs` checks the table definition, the create-only ensure loops and a same-input rebuild; it never runs against Appwrite). The owner ran the real migration on 2026-10-15. Acceptable: no live-Appwrite harness exists.

**SUGGESTION**

- S1 `dailyRate` uses `(1+EA)**(1/365)-1` instead of the AD10 `expm1(log1p(EA/100)/365)`. Identical to the precision of the goldens and equal to the spec formula; update the design text or switch for near-zero rates.
- S2 Nia writes legal rates with `verified:false` and source Nia (Telegram); confirming an existing verified row from Nia clears its verified flag. Conservative and documented; consider keeping `verified` on update or warning in the preview.
- S3 Nia month resolution on an exact 6-month tie resolves to the past (rationale: caps are certified before they are typed in). It satisfies within 6 months either way; add the rule to the spec at archive.
- S4 Five type-only or truthy-only assertions (see Assertion Quality) could assert the draft contents.
- S5 The working tree has untracked `.claude/` and `scripts/spike-transactions.mjs` (a spike unrelated to this change). Do not commit them with the archive.
- S6 At archive, merge the 7 deltas and 2 new capabilities into `openspec/specs`, carrying the W1, W2 and W5 wording fixes.

### Hygiene

- Commit attribution: a case-insensitive search for co-authored lines in all commit bodies of the range 061be51 parent to master returns 0 matches across 59 commits; one author; conventional-commit subjects.
- Secrets: no key, token, password or `.env` content in the diff; `.env` is git-ignored and untracked; only `.env.example` is tracked.
- Tracked artifacts: no tarballs, `node_modules/` or `dist/` tracked; `functions/*.tar.gz` is git-ignored (the package output is untracked).
- Docs: `docs/setup.md` (migration step, twelve tables) and `docs/deploy.md` (deploy order) updated; `functions/nia/README.md` lists the new actions including `late_policy` and cards.

### Verdict

**PASS WITH WARNINGS**

0 CRITICAL, 7 WARNING (documented deviations plus one small real UI defect, W6), 6 SUGGESTION. The full suite is green (124 files, 2004 tests), build and Nia package succeed, and every ADDED or MODIFIED requirement has implementing code and a passing covering test. Ready for `sdd-archive` after the optional W6 fix and the spec wording alignment (W1, W2, W5).

### Prioritized fix list

1. (W6, optional before archive) Card Tasa actual after a card `rate_change`: derive the rate in force; add a RED test in `RateChangeDialog.test.jsx` or `rateChangeModel.test.js`.
2. (Archive) Align spec wording: W1 (`previewChange` throws `installment_too_low`), W2 (arrears 391,756 and 390,381 versus `carriedMinor`), W5 (`verified` flag, no `since`, `asOf` year for Ley 1555), S3 (month tie rule).
3. (Owner) Confirm that W3 (card wizard without a mora control) and W4 (card revolving proration) are acceptable as built.
4. (Later) S1, S2, S4.
