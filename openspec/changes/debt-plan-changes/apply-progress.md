# Apply progress: debt-plan-changes

Mode: Strict TDD (Vitest, `npm test`). Delivery: auto-chain, stacked-to-main. Branches: `feat/dpc-a1-forward-compat` (A1), `feat/dpc-a2-legal-data` (A2), `feat/dpc-a3-ajustes` (A3), `feat/dpc-b1-preview-change` (B1), `feat/dpc-b2-rate-change` (B2), `feat/dpc-b3-charge-change` (B3), `feat/dpc-c1-late-terms` (C1), `feat/dpc-c2-late-accrual` (C2), `feat/dpc-c3-late-policy` (C3), `feat/dpc-f1-nia-restructure` (F1; E1 and E2 live on their own branches in the stack), `feat/dpc-d2-mora-ui` (D2, held for the owner gate D2.0), `feat/dpc-f2-nia-mora` (F2, held for the owner gate F2.0), `feat/dpc-f3-card-mora` (F3, on top of F2).

## Batch A1 (forward-compatible reader + legal resolve/cap/SMMLV): COMPLETE

### Tasks

- [x] A1a.1 RED `test/ledger/events.forward.test.js`
- [x] A1a.2 GREEN `src/ledger/events.js` (`readEvents`), `src/ledger/project.js` (`unknown_event_kind` notice)
- [x] A1b.1 RED `test/legal.resolve.test.js`, `legal.test.js` update, barrel exact-keys in `node16.test.js`
- [x] A1b.2 GREEN `src/legal.js`, `index.js`, `src/ledger/project.js` (`legalOf` into the projector context)
- [x] A1.CP checkpoint

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| a956e82 `feat(finance-core): skip unknown event kinds when reading, keep writes strict` | A1a | 4 files, 184 insertions, 10 deletions |
| 93fd58b `feat(finance-core): resolve household legal rates with stale cap carry-forward and basis-point usury` | A1b | 6 files, 585 insertions, 23 deletions |

Total vs master (code only, before this progress file): 9 files, 768 insertions, 32 deletions = 800 changed lines (budget 2,000; each group <= 800).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| A1a.1 / A1a.2 | `events.forward.test.js` against the pre-A1 `events.js` and `project.js` (061be51): 8 failed, 5 passed (re-run during this resume) | Same file with the A1a sources: 13/13 | None needed |
| A1b.1 / A1b.2 | Same tests against HEAD sources (resumed from a paused run; the WIP sources were copied aside and HEAD restored): `legal.resolve.test.js` fails at import (`resolveLegal is not a function`), `legal.test.js` stale carry-forward assertion fails (null vs `{ capEA: 27.1, stale: true }`), `node16.test.js` barrel exact-keys and working-functions fail (`usuryFromIbcBp is not a function`): 3 failed files, 3 failed tests | `npx vitest run packages/finance-core`: 22 files, 384 tests passed | Line endings normalized to CRLF on `legal.js` and `legal.resolve.test.js`; no logic change |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run packages/finance-core` exit 0: 22 files, 384 tests passed. Slice-level focused files: `events.forward.test.js` 13/13, `legal.resolve.test.js`, `legal.test.js`, `node16.test.js` all green |
| Runtime harness | `npm run package:nia` exit 0 (`functions/nia.tar.gz` written); `npm run build` exit 0 |
| Full suite | `npm test -- --maxWorkers=4`: first run 2 jsdom timeouts (known environmental flakiness, under load), rerun: 89 files, 992 tests passed |
| Rollback boundary | `src/ledger/{events,project}.js`, `src/legal.js`, `index.js` and their tests; revert the two commits. No stored data depends on them |

### Deviations from design

- `ley1555Notice` computes the 880 SMMLV threshold from the `asOf` year (as the `debt-prepayment-advice` spec says); the design interface line says "openedOn year". The spec wording was followed. Align the design text at verify.
- No other deviation. `readEvents` stays internal (not in the barrel), as designed.

### Owner gate

Deploy web and the Nia tarball at or after A1 before any build that can write `late_policy` (D2 web, F2 Nia).

### Remaining

None for A1. A2 below; A3 onward not started.

## Batch A2 (legal_rates schema, data layer, debt.legal decoration, load-time notices): COMPLETE

Branch `feat/dpc-a2-legal-data` (from master cb06d1d). No live Appwrite, Gemini or Telegram was touched; `npm run migrate:appwrite` was never run (the migration is covered by static and pure tests only).

### Tasks

- [x] A2a.1 RED `scripts/lib/legal-schema.test.mjs`
- [x] A2a.2 GREEN `scripts/lib/legal-schema.mjs`, `scripts/migrate-appwrite.mjs` (chained after `withDebtSchema`)
- [x] A2a.3 RED `src/appwrite.test.js`, `useDebtData.test.jsx`, `reconcile.test.js`, `wizardModel.test.js`, `DebtWizard.test.jsx`, `DebtsView.test.jsx`, `DebtDetail.test.jsx`, `DebtsContainer.test.jsx`
- [x] A2a.4 GREEN `src/appwrite.js`, `useDebtData.js`, `reconcile.js`, `DebtsView`, `DebtsContainer`, `DebtDetail`, `DebtDetailContainer`, `LegalRatesNotice.jsx` (new), `wizardModel.js`, `DebtWizard.jsx`
- [x] A2b.1 RED `functions/nia/debt/handler.test.js`, `preview.test.js`
- [x] A2b.2 GREEN `functions/nia/debt/handler.js` (`loadLegal`, `loadDebts`), `preview.js`; `docs/setup.md`, `docs/deploy.md`
- [x] A2.CP checkpoint

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| b11f2fb `feat(scripts): add the legal_rates table to the additive migration` | A2a schema | 3 files, 183 insertions, 1 deletion |
| 5f4ec1c `feat(debts): load household legal rates, decorate debts with them and surface load-time notices` | A2a web | 18 files, 581 insertions, 27 deletions |
| f37e4e1 `feat(nia): decorate debts with household legal rates and document the migration order` | A2b | 6 files, 198 insertions, 20 deletions |

Total vs master before this progress/tasks commit: 27 files, 962 insertions, 48 deletions = 1,010 changed lines (budget 2,000; each group <= 800).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| A2a.1 / A2a.2 | `legal-schema.test.mjs` failed at import (module not found), no tests ran | 14/14; `npx vitest run scripts` 57 passed | None needed |
| A2a.3 / A2a.4 data layer | 18 of 51 `appwrite.test.js` tests failed (TABLES exact keys, `listLegalRates`, `legalRateId`, `upsertLegalRate`, guards). A later triangulation (`kind: 'toString'`, `modality: 'constructor'`) failed for real (prototype keys passed the guard) and forced own-property checks | 51/51 | None needed |
| A2a.3 / A2a.4 wizard | `wizardModel.test.js` 4 failed (household cap 29.00, rate between caps, echo, SMMLV threshold 1,760,000,000 vs 1,540,796,400); `DebtWizard.test.jsx` 1 failed | 26/26 and 11/11 | None needed |
| A2a.3 / A2a.4 reconcile | `reconcile.test.js` 2 failed (unknown kind skip; debt with only unknown events must not remove rows) | 7/7 | The projection horizon now comes from all events, so one `project` call serves both the notice check and the expected rows |
| A2a.3 / A2a.4 hook | `useDebtData.test.jsx` 5 failed (decoration, 404 missing, 500 unavailable, reload) | 15/15 | None needed |
| A2a.4 notices | `DebtsView.test.jsx` 2 and `DebtDetail.test.jsx` 3 failed; `DebtsContainer.test.jsx` 2 failed (notice on list and detail, household cap in the wizard); the container notice test was re-verified RED by removing the `legalStatus` prop | 16/16, 11/11 and 16/16 | None needed |
| A2b.1 / A2b.2 | `preview.test.js` 2 failed (household cap in the preview, one unavailable line); `handler.test.js` 11 failed (`loadLegal`/`loadDebts` not exported, create preview with caps) | 18/18 and 57/57 | None needed |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run scripts packages/finance-core src/appwrite.test.js src/features/debts functions/nia` all green. Full `npm test -- --maxWorkers=4`: 90 files, 1,064 tests passed (baseline before A2: 89 files, 992 tests; the full runs passed with no jsdom timeout) |
| Runtime harness command/scenario and exact result | `npm run build` exit 0; `npm run package:nia` exit 0 (`functions/nia.tar.gz` written). `npm run migrate:appwrite` is an owner action and was not run: the schema is covered by `legal-schema.test.mjs` (shape, merge, static checks of the script, `node --check`) |
| Rollback boundary | Revert the three commits: `scripts/lib/legal-schema.*`, the migration import, the legal data layer in `src/appwrite.js`, the legal decoration and notices in the web debts feature, `handler.js`/`preview.js` in Nia and the two docs. The `legal_rates` table stays if the owner already migrated; nothing depends on it being empty |

### Decisions and deviations from design

- The new schema test is `legal-schema.test.mjs`, as the tasks say (the older one is `debt-schema.test.js`); Vitest picks up both.
- `evaluate(state, legal)` and `rateEcho(rate, modality, asOf, legal)` receive the whole resolved legal object (a superset of the design's `{ usuryTable }`), so the Ley 1555 notice also uses the household SMMLV.
- `upsertLegalRate` input is `{ kind, modality, validFrom, validTo, value, source, verified, actorId }`; guards reject with `error.reason` of `invalid_row`, `invalid_period` (ibc/usury must span exactly one calendar month, smmlv one calendar year) or `value_out_of_range`. Row id: `lr` + kind letter (i/u/s) + 2-letter modality code (co lo pd pr pu qr qu mg, `al` for smmlv) + yyyymm of `validFrom` + first 25 characters of the household id. `legalRateId` lives in `src/appwrite.js`; Nia E1 must reproduce it exactly (or it should move to the core then).
- `useDebtData` exposes `legal` and `legalStatus` (`ok` | `missing` for a 404 | `unavailable` for any other failure). A read failure never fails the load; debts get `resolveLegal.unavailable()`.
- The unknown-kind banner is on the detail only (the list has no per-debt notices yet). The `legal_rates_unavailable` banner is on the list and the detail.
- Nia: `DEBT_ROW_ACTIONS.legal_rates` and the `PATCH /rows/{id}` seam are E1 and were not touched. In A2 the only Nia preview that cites a cap is the new-loan preview, so the one-line notice is appended there. `index.js` needed no change: the real `listRows` already throws on a missing table (with `status`), which `loadLegal` absorbs.
- `planReconcile` takes its horizon from all events (not only active ones). `applied` does not depend on `asOf`, so the expected cost rows are unchanged.

### Owner gate

Run `npm run migrate:appwrite` (twice on dev first) BEFORE deploying A2 or later. Until then the web and Nia work with the code tables and show the `legal_rates_unavailable` notice.

### Remaining

A3 below; B1 onward not started.

## Batch A3 (Ajustes route and LegalRatesPanel): COMPLETE

Branch `feat/dpc-a3-ajustes` (from master 8c4aaa8). No live Appwrite call was made; every test mocks `src/appwrite`. No dev server was started.

### Tasks

- [x] A3a.1 RED `legalRatesModel.test.js`, `useLegalRates.test.jsx`, `Sidebar.test.jsx`, `MobileTabBar.test.jsx`, `App.test.jsx`
- [x] A3a.2 GREEN `legalRatesModel.js`, `useLegalRates.js`, `SettingsContainer.jsx`, minimal `SettingsView.jsx`; `navItems.js`, `Sidebar.jsx`, `MoreSheet.jsx`, `FinanceShell.jsx`
- [x] A3b.1 RED `LegalRatesPanel.test.jsx` (RTL); `SettingsContainer.test.jsx` added as integration coverage
- [x] A3b.2 GREEN `LegalRatesPanel.jsx`, `RateForm.jsx`, `SmmlvForm.jsx`, `FormParts.jsx`, `SettingsView.jsx`
- [x] A3.CP checkpoint

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| cc8db19 `feat(settings): open Ajustes from the sidebar and mobile sheet and load the household legal rates` | A3a | 13 files, 682 insertions, 10 deletions |
| 6ec6a20 `feat(settings): add the Tasas legales panel to view and edit IBC, usury and SMMLV` | A3b | 8 files, 786 insertions, 4 deletions |

Total vs master before this progress/tasks commit: 19 files, 1,464 insertions, 10 deletions = 1,474 changed lines (budget 2,000; each group <= 800).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| A3a.1 / A3a.2 model | `legalRatesModel.test.js` failed at import (module not found), no tests ran | 65 tests in the file | None needed |
| A3a.1 / A3a.2 hook | `useLegalRates.test.jsx` failed at import | 7 tests: load, 404 `missing`, `unavailable` plus reload, save then reload, failed save then retry, double submit one write, no write while unreadable | None needed |
| A3a.1 / A3a.2 shell | Safety net `src/features/shell src/app`: 8 files, 93 tests passed. New tests failed: `Sidebar` 2 (Ajustes was a disabled "Próximamente" button), `MobileTabBar` 1, `App` 2 | `npx vitest run src/features/settings src/features/shell src/app`: 10 files, 170 tests passed. The App tests first failed once more on a test bug (Ajustes sits outside the `nav`, so the lookup moved to the sidebar `complementary`) | None needed |
| A3b.1 / A3b.2 panel | `LegalRatesPanel.test.jsx` failed at import (component file moved away to prove it) | 27 tests. First run green; mutation checks then broke the past-month warning, the read-only guard and the manual-wins note: 4 tests failed, sources restored, 99/99 settings tests green | The Verificado hint moved out of the checkbox label (it polluted the accessible name) |
| A3b integration | `SettingsContainer.test.jsx` written after the panel, so it passed first run (integration coverage, not a RED step): save as the signed-in member then reload, failed write then retry, missing table, read failure then retry | 4/4 | None needed |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run src/features/settings src/app src/features/shell` exit 0: 12 files, 201 tests passed. Full `npm test -- --maxWorkers=4`: 94 files, 1,172 tests passed on the first run (baseline before A3: 90 files, 1,064 tests) |
| Runtime harness command/scenario and exact result | `npm run build` exit 0 (`SettingsContainer-*.js` emitted as its own lazy chunk). `npm run package:nia` not required for A3 (no Nia change) |
| Rollback boundary | Revert the two commits: `src/features/settings/*` and the nav edits (`navItems.js`, `Sidebar.jsx`, `MoreSheet.jsx`, `FinanceShell.jsx`) with their shell and App tests. Nothing else depends on them |

### Decisions and deviations from design

- Extra files beyond the design list: `RateForm.jsx`, `SmmlvForm.jsx` and `FormParts.jsx` (split of the panel to keep each file readable) and `SettingsContainer.test.jsx`. `SettingsView.jsx` first ships as a header-only view in A3a (the container must import something that exists, so A3a stays green) and gains the panel in A3b.
- `navItems.js` exports `SETTINGS_ITEM` instead of adding Ajustes to `NAV_ITEMS`: the sidebar pins it at the bottom, outside the General list and outside the `nav` landmark, and the mobile tab bar keeps its four tabs (Ajustes lives in the "Más" sheet).
- Percentages are parsed in integer arithmetic (`parsePercentBp`): comma or dot decimal, at most two decimals, an optional `%`. 1,15 gives 115 (a float would give 114.99999999999999). The form IBC and usury ranges (5,00 to 100,00 % E.A.) and the SMMLV range mirror `upsertLegalRate`, which stays the write authority.
- Mortgage has no IBC toggle: the form writes the usury only (`validateRateDraft` also rejects mortgage plus IBC). The panel prompts "Registrar tope hipotecario" until a mortgage cap exists (owner action 4).
- Editing a past month shows a warning in the form ("se recalculan al abrir cada deuda"); it does not block the save. A form also says when a manual usury already wins over an IBC for the month, or that saving replaces a stored row.
- When `legalStatus` is `missing` or `unavailable` the panel shows the app values read-only with the banner (`Falta actualizar la base de datos` or `No pudimos leer las tasas legales` with Reintentar); forms and edit buttons are hidden, so nothing can be written blind.
- Any household member can edit; the signed-in user is the audited `actorId`.
- Spec scenario "Informational only" (a warning when a debt rate exceeds the cap) is covered by the A2 notices and the panel copy "Informativo: el extracto del banco manda"; A3 adds no new debt-side warning.

### Owner gate

Owner action 4 is now possible once the migration (`npm run migrate:appwrite`) has run: enter the mortgage usury caps and the monthly IBC or usury in Ajustes.

### Remaining

B1 below; B2 onward not started.

## Batch B1 (previewChange, removeCharge, void rules, history summaries): COMPLETE

Branch `feat/dpc-b1-preview-change` (from master 0145d00). No live Appwrite call was made; the web tests mock `src/appwrite`. No dev server was started.

### Tasks

- [x] B1a.1 RED `packages/finance-core/test/ledger/preview.test.js`, barrel exact-keys and source list in `test/node16.test.js`
- [x] B1a.2 GREEN `src/ledger/{snapshot,preview}.js`, `src/prepay/simulate.js` (uses the shared snapshot), `src/charges.js` (`removeCharge`), `src/ledger/tail.js`, barrel (`previewChange`, `removeCharge`, `normalizeCharges`); `card/card.js` untouched (the characterization test passed as is)
- [x] B1b.1 RED `debtDetailModel.test.js`, `eventSummary.test.js`, `EventHistory.test.jsx`, `VoidDialog.test.jsx`, plus three container tests in `DebtDetailContainer.test.jsx`
- [x] B1b.2 GREEN `eventSummary.js`, `debtDetailModel.js`, `EventHistory.jsx`, `VoidDialog.jsx`, `DebtDetailContainer.jsx` (void success message by kind)
- [x] B1.CP checkpoint

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| 82c8f12 `feat(finance-core): preview rate, charge and restructure changes before saving them` | B1a core | 8 files, 415 insertions, 20 deletions |
| 6ef16e7 `feat(debts): summarize plan changes in the history and void them, guarding the restructure` | B1b web | 10 files, 593 insertions, 17 deletions |

Total vs master before this progress/tasks commit: 18 files, 1,008 insertions, 37 deletions = 1,045 changed lines (budget 2,000; each group <= 800).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| B1a.1 / B1a.2 | Safety net `npx vitest run packages/finance-core src/features/debts`: 45 files, 576 tests passed. New: `preview.test.js` failed at import, and `node16.test.js` failed 3 tests (barrel exact keys, working functions, source list) | `preview.test.js` 22/22 and `node16.test.js` green; `packages/finance-core functions/nia src/features/debts`: 56 files, 787 tests passed. First GREEN run had 6 failures that were test-data bugs, not code bugs (a nominal-rate shape, backdated by one day, a payment that overpaid the rebuilt row, a manual plan below its interest, card statements closed by the reference date, the shape of a normalized ZERO rate) | Mutations: reference date instead of `max(on, effectiveOn)` and a non-transitive `removeCharge` each failed the intended tests; sources restored |
| B1b.1 / B1b.2 model + summaries | `eventSummary.test.js` failed at import; `debtDetailModel.test.js` 24 failed (`voidRuleOf` and `voidSuccessMessage` did not exist, history had no summary or guard fields) | 39 tests in the two files | None needed |
| B1b.1 / B1b.2 dialogs and history | `EventHistory.test.jsx` 2, `VoidDialog.test.jsx` 4 and `DebtDetailContainer.test.jsx` 3 failed (the payment cases of the same files already passed as a safety net) | `npx vitest run src/features/debts`: 25 files, 238 tests passed | Mutations: guarded confirm not disabled, `late_policy` dropped from the blockers, `mantiene cuota` text each failed 1 test; sources restored |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run packages/finance-core/test/ledger/preview.test.js src/features/debts/debtDetailModel.test.js` green (22 + 39 tests with `eventSummary.test.js`). `npx vitest run packages/finance-core functions/nia src/features/debts`: 56 files, 787 tests passed after B1a; `src/features/debts`: 25 files, 238 passed after B1b. Full `npm test -- --maxWorkers=4`: 97 files, 1,240 tests passed on the first run (baseline before B1: 94 files, 1,172 tests) |
| Runtime harness command/scenario and exact result | `npm run build` exit 0; `npm run package:nia` exit 0 (`functions/nia.tar.gz` written; core scan green) |
| Rollback boundary | Revert the two commits: `src/ledger/{snapshot,preview}.js`, `prepay/simulate.js` (back to its private snapshot), `removeCharge`, the two `tail.js` return values, the barrel and node16 edits, and the web model, summary, history and void dialog files with their tests. No stored data depends on them |

### Decisions and deviations from design

- `previewChange` measures `before` and `after` at `max(on, effectiveOn)` (the same date `planCommit` projects at) so the preview equals the saved projection. `backdated` is `effectiveOn < on`. `impacted` compares the `costMinor` of every applied event present in both replays, in chronological order. A draft of any other kind (including `late_policy`, which arrives in C3a) throws `ValidationError('invalid_draft')`.
- `installment_too_low` needed no preview code: `project()` already throws it from `buildSchedule`, and the preview lets it through (design wording; the spec says "return a typed error": align the spec at verify, as the tasks already note).
- The shared `snapshot` is a superset of the old simulation snapshot (adds `pastDueMinor`, `lateInterestMinor`, `remainingCostMinor`), so `simulateExtra` results gain those three fields; nothing asserted exact equality on them. `lateInterestMinor` reads `projection.lateInterestMinor ?? 0` and becomes real in C2.
- Extra core change not in the file map: `applyRestructure` returns `carriedMinor` in its applied entry. The history summary "Reestructuración: $ X a N cuotas" needs the carried balance, and `principalMinor` in the payload is informational (AD13).
- The card `rate_change` handler is unchanged, so a card entry in `applied` has no `fromEA`; the summary then shows only the new EA from the payload and leaves the keep-term and keep-installment wording out for cards.
- A charge change is summarized against the charges in force just before it (terms charges, then each active `charge_change` or `restructure`), so the summary lists added, modified and removed ("sin X") charges, two labels at most plus `(+n)`.
- `voidRuleOf(event, activeSorted)` returns `{ voidable, guarded, voidBlocked }`; history entries gain `summary`, `guardedVoid` and `voidBlocked`. A `late_policy` event is skipped by the core until C3, so its void rule and summary are covered with plain event objects only.
- A blocked restructure void shows a dialog that only names the blockers and offers "Entendido" (no checkbox, no reason field, no write); an allowed one requires the confirmation checkbox. Reconcile after a plan-change void is B2 (`afterSave`).
- The void success toast depends on the event kind (`voidSuccessMessage`); the container passes the kind with the reason.

### Owner gate

None for B1 (no schema, no deploy order).

### Remaining

B2 onward (not started).


## Batch B2 (Más acciones menu, RateChangeDialog, post-save reconcile): COMPLETE

Branch `feat/dpc-b2-rate-change` (from master d4e7c39). No live Appwrite call was made (web tests mock `src/appwrite`). No dev server was started, so the layout was not checked in a browser.

### Tasks

- [x] B2a.1 RED `MoreActionsMenu.test.jsx`, `rateChangeModel.test.js`, `useCommitDialog.test.jsx` (new), `useDebtData.test.jsx`, `debtDetailModel.test.js`, `DebtDetailContainer.test.jsx` (void reconcile)
- [x] B2a.2 GREEN `MoreActionsMenu.jsx`, `rateChangeModel.js`, `useCommitDialog.js` (`afterSave`), `useDebtData.js` (`reconcileCosts(debtId, { fresh })`), `debtDetailModel.js` (`PLAN_CHANGE_KINDS`, `withReconcileNote`), `DebtDetailContainer.jsx` (void of a plan change reconciles), `wizardModel.js` (exports `toRate`, `usuryModality`)
- [x] B2b.1 RED `RateChangeDialog.test.jsx`, container rate change flow in `DebtDetailContainer.test.jsx`, menu wiring in `DebtDetail.test.jsx` and `DebtDetail.card.test.jsx`
- [x] B2b.2 GREEN `RateChangeDialog.jsx`, `DebtDetail.jsx`, `DebtDetailContainer.jsx`
- [x] B2.CP checkpoint

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| 7a0d581 `feat(debts): add the Más acciones menu, the rate change model and a post-save cost reconcile` | B2a | 13 files, 660 insertions, 12 deletions |
| 7042611 `feat(debts): change the rate from Más acciones with a live before/after preview` | B2b | 7 files, 454 insertions, 5 deletions |

Total vs master before this progress/tasks commit: 18 files, 1,114 insertions, 17 deletions = 1,131 changed lines (budget 2,000; each group <= 800).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| B2a.1 / B2a.2 reconcile plumbing | Safety net `npx vitest run src/features/debts`: 25 files, 238 tests passed. New tests failed: `useCommitDialog.test.jsx` 5, `useDebtData.test.jsx` 3 (fresh read), `debtDetailModel.test.js` 4 (`withReconcileNote`, `PLAN_CHANGE_KINDS`), `DebtDetailContainer.test.jsx` 2 (void reconcile and its failure) | 4 files, 75 tests. One extra case surfaced in GREEN (a flow with `afterSave` that resolves nothing, such as a payment void, crashed the note builder): fixed in `withReconcileNote` and pinned with a unit test | Mutation: dropping `afterSave` from the already-saved branch failed 1 test; restored |
| B2a.1 / B2a.2 model | `rateChangeModel.test.js` and `MoreActionsMenu.test.jsx` failed at import (modules did not exist) | 16 model tests and 8 menu tests. First run had 1 failure that was test data (a card rate change effective today moves no minimum payment): the scenario now backdates it | Mutations: no mode clamp failed the German case, a card keeping "Reestructurar" failed the card menu case; restored |
| B2b.1 / B2b.2 dialog | `RateChangeDialog.test.jsx` failed at import; detail, card detail and container tests failed (no "Más acciones" button) | Dialog 12 tests, container flow 6 tests, detail 2 tests. Three first-run failures were wrong expectations, not code: the EA echo text is `26.82% EA`, the next installment excludes the fee (380,381 not 390,381), and the card case needed its payment | Mutations: hiding the too-low message failed 1 test, hiding the backdated block failed 3, dropping `afterSave` from the rate change failed 2; restored. Full `src/features/debts`: 29 files, 298 tests passed |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run src/features/debts` exit 0: 29 files, 298 tests passed (baseline before B2: 25 files, 238). Full `npm test -- --maxWorkers=4`: 101 files, 1,300 tests passed on the first run (baseline before B2: 97 files, 1,240 tests) |
| Runtime harness command/scenario and exact result | `npm run build` exit 0 (`DebtsContainer-*.js` emitted). `npm run package:nia` not required for B2 (no core or Nia change) |
| Rollback boundary | Revert the two commits: `MoreActionsMenu.jsx`, `rateChangeModel.js`, `RateChangeDialog.jsx` with their tests, `afterSave` in `useCommitDialog.js`, the `fresh` option of `reconcileCosts`, `PLAN_CHANGE_KINDS` and `withReconcileNote`, the menu and rate change wiring in `DebtDetail.jsx` and `DebtDetailContainer.jsx`, and the two wizard exports. No stored data depends on them |

### Decisions and deviations from design

- Void reconcile is wired in B2a (not B2b): the B2a RED asks that a void of a plan change reconciles, and that needs the container. Only `rate_change`, `charge_change`, `restructure` and `late_policy` voids reconcile; a payment void does not (its cost row is already deleted by the void).
- `afterSave({ input, context })` runs after `reload()` and before `onRefresh()` so the shell refresh sees the repaired cost rows. It never undoes a save: a rejection reaches `successMessage(input, after)` as `{ error }` and the toast says the costs were not refreshed. `after` is `{ value }`, `{ error }` or `undefined`.
- `reconcileCosts(debtId, { fresh: true })` reads `listDebtEvents(debtId)` again (AD16). The default still reads the hook state, so the open-time repair costs no extra read.
- Toast wording: `Cambio de tasa registrado. Se actualizaron 2 filas de Costos financieros.` (singular `1 fila`); nothing is added when no row changed.
- "2% monthly" in the spec is the effective monthly convention `M.V.` (2% a month is 26.82% EA); `N.M.V.` 2% would be 2.02% EA. The tests use `M.V.`. The echo text is the wizard's `describeRate` (`2% MV ≈ 26.82% EA`), reused as is.
- The effective date drives the usury notice (the cap in force that month), not today. The default date is today.
- A card gets no mode choice and no "mantiene plazo" text; its preview compares the next minimum payment and interest still to pay and leaves out remaining installments. The draft it sends carries `mode: 'keep_term'`, which the card handler ignores.
- `installment_too_low` is not an error the user sees under `keep_installment`: the dialog keeps the choice in its form, falls back to `keep_term` in the preview and the draft, and shows the specified message. Under `keep_term` the same error shows a different message (`CANNOT_AMORTIZE`) because the specified one tells the user we already chose `keep_term`.
- A rate change that moves no figure shows "Este cambio no modifica ninguna cuota." and does not block saving.
- `MoreActionsMenu` shows an item only when its handler is wired, so B2 shows "Cambiar tasa" alone; B3, D1 and D2 add the others. Picking an item focuses the trigger before the dialog opens so the dialog returns focus to a control that exists.
- Extra exports beyond the design: `toRate` and `usuryModality` from `wizardModel.js`.

### Owner gate

None for B2 (no schema, no deploy order).

### Remaining

B3 onward (not started).


## Batch B3 (ChargesEditor, ChargeChangeDialog, Más acciones wiring): COMPLETE

Branch `feat/dpc-b3-charge-change` (from master 2ea40f6). No live Appwrite call was made (web tests mock `src/appwrite`). No dev server was started, so the layout was not checked in a browser.

### Tasks

- [x] B3a.1 RED `chargesEditorModel.test.js`, `ChargesEditor.test.jsx`
- [x] B3a.2 GREEN `chargesEditorModel.js`, `ChargesEditor.jsx`
- [x] B3b.1 RED `chargeChangeModel.test.js`, `ChargeChangeDialog.test.jsx`, charge change flow in `DebtDetailContainer.test.jsx`, card flow in `DebtDetailContainer.card.test.jsx`, menu test in `DebtDetail.test.jsx`, `snapshot` cases in `preview.test.js`
- [x] B3b.2 GREEN `chargeChangeModel.js`, `ChargeChangeDialog.jsx`, `DebtDetailContainer.jsx` (the menu item comes with the existing `MoreActionsMenu`), `snapshot.js`
- [x] B3.CP checkpoint

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| 0f2fc7e `feat(debts): edit real charges with a charges editor that validates references and lists dependents` | B3a | 4 files, 775 insertions |
| 4b914d2 `feat(finance-core): report the next installment total with its charges in plan snapshots` | B3a/B3b bridge (core) | 2 files, 16 insertions, 3 deletions |
| 881f029 `feat(debts): change insurance and charges from Más acciones with a before/after preview` | B3b | 12 files, 710 insertions, 52 deletions |

Total vs master before this progress/tasks commit: 18 files, 1,501 insertions, 55 deletions = 1,556 changed lines (budget 2,000; each group <= 800).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| B3a.1 / B3a.2 model | `chargesEditorModel.test.js` failed at import (module did not exist) | 22 tests: round trip of real charges (cadence, periods, `pctOfBase`, `display`), 10,000 to 12,000, comma and dot percentages with no float drift, thousand dots in pesos, dangling, later and subtotal references, transitive dependents, presets, custom ids | Removed unused `unit` fields from the basis table. Mutation: allowing 5 decimals failed the over-precise case; restored |
| B3a.1 / B3a.2 editor | `ChargesEditor.test.jsx` failed at import | 14 tests. Mutations: removal without the dependents confirmation failed 2 tests, a fieldset that ignored `disabled` failed the freeze test; restored. `npx vitest run src/features/debts`: 31 files, 334 tests passed | None needed |
| B3b core `snapshot` | Safety net `packages/finance-core`: 23 files, 407 tests passed. `preview.test.js` failed 4: the exact-keys snapshot, the fee case, the charge change preview and the new card minimum case | 23 files, 407 tests passed; `functions/nia packages src/features/debts`: 64 files, 930 tests | None needed |
| B3b.1 / B3b.2 model | `chargeChangeModel.test.js` failed at import | 15 tests, all numbers derived by hand first (392,281 to 394,661; 35 x 11,900 to 35 x 14,280; 3 x 11,900 + 32 x 14,280 for a June date; the backdated cost 192,776 to 195,156; the card minimum 146,102 to 149,672). Mutations: dropping the `same` guard failed 4 tests, dropping the payload guard 1, folding future card changes 1; restored | `BackdatedNotice` and `BeforeAfterPreview` extracted from `RateChangeDialog` with its 12 tests as safety net (still green); `impactedFor` exported |
| B3b.1 / B3b.2 dialog | `ChargeChangeDialog.test.jsx` failed at import | 12 tests. Mutations: hiding the backdated block failed 1, enabling the save without a draft failed 3; restored | None needed |
| B3b.1 / B3b.2 wiring | 8 new container tests failed (no menu item); the 9th failure of the run was the known simulator timeout | `DebtDetailContainer*.test.jsx`: 38 passed; one more menu test in `DebtDetail.test.jsx` (passthrough, covered by B2 so green on first run) | Mutation: dropping `afterSave` from the charge change failed 2 reconcile tests; restored |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run src/features/debts` exit 0: 33 files, 370 tests passed (baseline before B3: 29 files, 298). Full `npm test -- --maxWorkers=4`: 105 files, 1,373 tests passed on the first run (baseline before B3: 101 files, 1,300) |
| Runtime harness command/scenario and exact result | `npm run build` exit 0. `npm run package:nia` exit 0 (not required for B3 by the plan, run because `snapshot.js` is core code that Nia packages) |
| Rollback boundary | Revert the three commits in reverse order: `ChargeChangeDialog.jsx`, `chargeChangeModel.js`, `ChargesEditor.jsx`, `chargesEditorModel.js`, `BackdatedNotice.jsx`, `BeforeAfterPreview.jsx` with their tests, the `chargeChange` dialog in `DebtDetailContainer.jsx`, `impactedFor` export and the two extracted components in `RateChangeDialog.jsx`, and `nextTotalMinor` in `snapshot.js`. No stored data depends on them |

### Decisions and deviations from design

- Core change outside the file map: `snapshot()` gains `nextTotalMinor` (the first open row's `totalDueMinor`: installment plus its charges and taxes, and a card's minimum payment). The existing `installmentMinor` leaves charges out, so a charge change could not be previewed from it. It is a pure addition in its own commit; the exact-keys snapshot test changed RED-first. No other caller reads the new field yet.
- The dialog compares "Próxima cuota con cargos" and "Cargos por pagar" (`remainingChargesMinor`) for a loan and only "Pago mínimo" for a card (a card's accrued charges are billed at the next statement, so a remaining-charges row would show zeros). A card has no mode choice, and a loan has none either: a charge change has no `mode`.
- The charges in force for a card are folded from the active `charge_change` events up to today (`chargesInForce`): the card projection keeps the original `terms`, unlike a loan, whose `terms` already hold the applied changes. The same limit exists in the B2 rate dialog (a card's "Tasa actual" comes from `projection.terms.rate`); it is not fixed here.
- The editor works on drafts (strings) and `validateCharges` is the only bridge to real `Charge` objects; the core `normalizeCharges` still has the last word. Percentages accept a comma or a dot and up to four decimals (0..100); fixed values are whole pesos and accept thousand dots. "% de una base fija" (`pctOfBase`, with its `baseMinor`) is kept for a stored charge that already uses it but is not offered for new ones.
- Removing a charge that others are calculated on asks first, naming them ("Al quitar «Comisión» también se quita «IVA sobre la comisión»..."), and uses the core `removeCharge`. The dangling-reference error is therefore reached by changing a base (for example a fee moved to "% de lo que pagas en la cuota"), by a new "% de otro cargo" row without a base, or by a charge listed before its base.
- A set equal to the one in force shows "Todavía no cambiaste ningún cargo." and disables the save (no empty event). A change that moves no figure (a rename) is still saveable and says so. A payload over 8,000 characters is blocked with a message.
- Extra files beyond the design list: `chargeChangeModel.js` (+test), `BackdatedNotice.jsx` and `BeforeAfterPreview.jsx` (extracted from `RateChangeDialog` so D1 can reuse them). `MoreActionsMenu.jsx` and `DebtDetail.jsx` needed no change: the "Cambiar seguros y cargos" item already existed and shows once `onChargeChange` is wired.
- History summaries show the labels of changed charges since B1 (`chargesSummary`); no change was needed.

### Owner gate

None for B3 (no schema, no deploy order).

### Remaining

C1 onward (not started).


## Batch C1 (terms.late, terms.modality, daily rate): COMPLETE

Branch `feat/dpc-c1-late-terms` (from master 2fb3324). Core only: no web, Nia, schema or deploy change.

### Tasks

- [x] C1.1 RED `test/late/policy.test.js` (27 tests), `terms.test.js` (5 tests), `node16.test.js` (source list, exact keys, working-function checks)
- [x] C1.2 GREEN `src/late/policy.js`, `src/terms.js`, `index.js`
- [x] C1.CP checkpoint

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| `feat(finance-core): validate late interest policy and modality in terms and resolve the daily rate with the usury cap of each day` | C1 (single group) | 6 files, 447 insertions |

Total vs master before this progress/tasks commit: 6 files, 447 insertions = 447 changed lines (budget 2,000; group <= 800).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| C1.1 / C1.2 `policy.js` | Safety net `packages/finance-core`: 23 files, 407 tests passed. `policy.test.js` failed at import (module did not exist); in the same run `terms.test.js` failed 3 (late and modality dropped by `validateTerms`) and `node16.test.js` failed 3 (source list, exact keys, working functions) | `packages/finance-core`: 24 files, 439 tests passed. Triangulated: every mode with cap, no cap, stale cap and mid-way cap change; mortgage with and without an explicit cap; modality override both ways; defaults for all nine kinds. Golden `dailyRate(28.59)` = 0.00068917 (1e-8) and 0.000689165756 (1e-12), 27.5 and 40 | None needed. Mutations: `Math.min` to `Math.max` failed 3 tests, dropping the stale notice failed 2, widening the multiple limit to 30 failed 1, deleting the `terms.late` line in `validateTerms` failed 3; all restored |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run packages/finance-core/test/late/policy.test.js` exit 0: 1 file, 27 tests passed. `npx vitest run packages/finance-core`: 24 files, 439 tests passed (baseline 23 files, 407). Full `npm test -- --maxWorkers=4`: 106 files, 1,405 tests passed (baseline before C1: 105 files, 1,373) |
| Runtime harness command/scenario and exact result | `npm run package:nia` exit 0 (core is bundled into the Nia package). `npm run build` exit 0 |
| Rollback boundary | Revert the C1 commit: `src/late/policy.js`, the `late` and `modality` lines in `terms.js`, the seven barrel exports and the three test files. No stored data depends on it: `late` and `modality` are written only when present, and nothing writes them yet |

### Decisions and deviations from design

- Names: the design lists `lateEAOn`; the orchestrator brief names `lateRateOn`. Both exist: `lateEAOn(terms, day, legal)` returns `{ ea, notices }` and `lateRateOn` adds `daily`. Both take the terms in force on that day (the contract rate and the policy only change at events, as in the design) and a resolved `legal` (default: the code tables).
- `late_mortgage_unverified` is returned by `lateEAOn` for any mortgage-modality debt whose mode is not `none` (design says `project()` raises it under the same condition). C2 only has to collect the notices and dedupe them.
- `normalizeLate` rejects a `fixed` rate whose EA is 0 (spec: "rate > 0"). C2a's "0% fixed gives 0" case cannot be built through `validateTerms`: build it with `contract_multiple` over a 0% contract rate, or call the engine with a hand-built policy.
- `normalizeLate` drops fields the mode does not use and ignores `since` (design: `late_policy.effectiveOn` replaces it, per the tasks forecast note). `graceDays` is always present after normalization (default 0).
- `late` and `modality` are written by `validateTerms` only when present in the input, so every pre-existing serialized terms document and every S3a fixture stays byte-identical.
- Error codes: `invalid_late` for policy errors, `invalid_rate` for a malformed fixed rate or `dailyRate` input, `invalid_terms` for an unknown `modality`, `invalid_date` for a bad day.
- Notice shape: `{ code, severity: 'info', blocking: false, modality, asOf, lastValidTo? }`.

### Owner gate

None for C1 (no schema, no deploy order). From C2 on, web and Nia deploy together (owner action 3).

### Remaining

C2 onward (not started).

## Batch C2 (mora accrual inside project): COMPLETE

Branch `feat/dpc-c2-late-accrual` (from master 23042cb). Core only: no web, Nia, schema or deploy change in code, but from this slice on the web build and the Nia tarball deploy together (owner action 3).

### Tasks

- [x] C2a.1 RED `test/late/accrue.test.js` (23 tests), `test/ledger/rows.test.js` (6 tests), `node16.test.js` (source list)
- [x] C2a.2 GREEN `src/late/accrue.js`, `src/ledger/rows.js`
- [x] C2b.1 RED fixture `late-28.59-golden.json`, `test/ledger/project.late.test.js` (23 tests), `test/late/properties.test.js` (7 tests, 200 seeded loans), `test/ledger/project.parity.test.js` (9 tests)
- [x] C2b.2 GREEN `src/ledger/project.js` (clock, calls before each event and at `asOf`, fields, notices), `rows.js` (`decorate` fields)
- [x] C2.CP checkpoint

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| fadf984 `feat(finance-core): accrue late interest per overdue row on unpaid principal with one rounding and expose it in the row amounts due` | C2a | 5 files, 403 insertions, 4 deletions |
| 050ba5d `feat(finance-core): project mora per row with goldens for the 28.59% installment, notices and invariant properties` | C2b | 7 files, 510 insertions, 6 deletions |

Total vs master before this progress/tasks commit: 10 files, 911 insertions, 8 deletions = 919 changed lines (budget 2,000; each group <= 800).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| C2a.1 / C2a.2 `accrue.js` | Safety net `packages/finance-core`: 24 files, 439 tests passed. `accrue.test.js` failed at import (module did not exist) and `node16.test.js` failed 1 (source list) | `accrue.test.js`: 23 tests. Goldens 1,375 (exact 1,374.92), 4,125, grace 3 gives 7 days, mid-way cap 1,352 (687.46 + 664.18), a gap between caps carries the earlier one with `late_cap_stale`, fixed 40% equals usury, none / absent / 0% contract multiple give 0, day clock (due date and payment day), no cap gives contract EA + `late_cap_unknown`, base is unpaid principal only, settled and capitalizing rows give 0, path independence | Imports ordered; `addLateNotices` split out. Mutations: `days + 1` failed 17, `row.late.days += 1` failed 5, notices raised on every segment failed 18, cutting segments at `validFrom` instead of the day before failed 1 (added the gap test after the first version of that mutation survived); all restored |
| C2a.1 / C2a.2 `rows.js` | `rows.test.js` failed 6 (`lateMinor` undefined, no `late` accumulator) | 6 tests: new row, accrued mora in `rowDue` and `rowOutstanding`, paid mora per bucket, rounding unit, settled row, no `late` leak in `decorate` | None needed |
| C2b.1 / C2b.2 parity | Approval test written before any production change: 8 scenarios hashed on master code (untouched, late and partial payments, bank split + extra payment, rate/charge change + restructure, interest-free + adjustment, manual plan, balance-only, total grace). The first baseline missed `nextDue` (a plan row), so it was re-hashed on the master code once with the final stripping helper | 9 tests green on the new code: every pre-existing field byte-identical and all mora fields 0 | None needed |
| C2b.1 / C2b.2 `project.late.test.js` | 35 failed in the first RED run (new fields undefined) | 23 tests: the 5 fixture cases (pastDue 391,756; 390,381 on day 10 gives 10,000 / 1,375 / 180,876 / 198,130 and cost 192,251; 100,000; 300,000 then 632), no compounding, bank-stated 5,000 under none, fixed below cap, interest-only, rate change segment (5 days at 24% + 5 at 20%), payment on the due date and the day after, restructure carries the mora (1,375), notices (stale, unknown, mortgage unverified, ordering with `surplus`), interest-free, balance-only. Mutations: removing the call before each event failed 9, removing the call at `asOf` failed 12, dropping `remainingLateInterest` failed 4; all restored | None needed |
| C2b.1 / C2b.2 `properties.test.js` | Failed with the rest of the RED run | 7 properties over 200 seeded loans (mulberry32): non-negative and monotonic, bounded by the 28.59% cap, zero for none / 0% / before due, independent of charges and taxes, interest-only rows before the last give 0, +/-1 peso with a no-op boundary (>= 195 of 200 identical), non-negative with payments | None needed |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run packages/finance-core/test/late packages/finance-core/test/ledger` exit 0: 13 files, 224 tests passed. `npx vitest run packages/finance-core`: 29 files, 507 tests passed (baseline 24 files, 439). Full `npm test -- --maxWorkers=4`: 111 files, 1,473 tests passed on the first run (baseline before C2: 106 files, 1,405) |
| Runtime harness command/scenario and exact result | `npm run package:nia` exit 0 (core is bundled into the Nia package). `npm run build` exit 0 |
| Rollback boundary | Revert the two commits (C2b then C2a): `src/late/accrue.js`, the `late` accumulator, `lateMinor`, `lateInterest` in `rowDue` and the mora term in `rowOutstanding` (`rows.js`), the clock, calls, notices and fields in `project.js`, plus the five test files, the fixture and the node16 source-list line. No stored data depends on them: only debts with `terms.late` (none can be created before D2/F2/C3) project any mora |

### Decisions and deviations from design

- `accrueLate(state, to, legal)` is internal: it is not exported from the barrel (the design file map lists no barrel change for C2) and `node16.test.js` only gained the source-list entry. `addLateNotices` is exported from `accrue.js` for `project.js`.
- State shape: `lateClock` starts at `terms.openedOn` (rows accrue only after their own `dueOn + graceDays`, so the start only bounds the first window) and `lateNotices` is a deduplicated array on the state. The dedupe key is `code | modality | lastValidTo`; the first occurrence is kept, so its `asOf` is the first day that raised it.
- Cap notices (`late_cap_stale`, `late_cap_unknown`) are raised only for segments where some row actually had a base, so a debt that is not overdue shows none. `late_mortgage_unverified` is raised whenever the mode in force at `asOf` is not `none` and the modality is `mortgage`, overdue or not (design wording).
- Segments are cut at the day before every `validFrom` and at every `validTo` of the modality's cap entries, so a gap between two caps is evaluated as carried (stale) and the next cap starts exactly on its `validFrom`. Rows get their own start (`dueOn + graceDays`) inside each segment. Contract-rate changes need no extra cut because accrual runs before every event.
- `row.late = { exact, days, unit }`: the rounding unit is stored by `accrueLate` (`terms.roundingUnit`), because rows do not know the terms. `lateMinor(row) = roundUnit(exact, unit)` (exported from `rows.js`).
- `lateBaseMinor` of a plan row is the unpaid principal now, shown only when the row has accrued days (`lateDays > 0`), so a row that was never overdue shows 0; the golden "base 199,505" and "base 91,756" hold.
- `decorate` hides the private `late` accumulator and adds `lateMinor`, `lateDays`, `lateBaseMinor` to every plan row, so `nextDue` (a plan row) carries them too. The spec wording "new fields 0" was followed literally: the fields exist and are 0 for debts without a policy (the parity test strips them and compares the rest byte for byte).
- The daily rate keeps the C1 form `(1 + EA)^(1/365) - 1` (the orchestrator brief) rather than the `expm1/log1p` of AD10; both give 0.0006891657555 at 28.59% to the precision the goldens need.
- A restructure needs no change for C2: arrears (including accrued mora) are already capitalized through `rowOutstanding`; one test pins the 1,375 difference. `waiveLate` and the no-mora-on-replaced-rows checks stay in C3.
- The fixture holds its own usury table (2026, 28.59%) and the tests inject it through `opts.legal`, so the goldens do not depend on the code table.

### Owner gate

From C2 on, deploy the web build and the Nia tarball together every time (owner action 3): both runtimes must use the same mora engine or reconcile will flip cost rows. Nothing creates a mora policy yet (C3 adds `late_policy`, D2 and F2 add the UIs), so no stored data changes with this slice.

### Remaining

C3 onward (not started).


## Batch C3 (late_policy event, waiveLate and restructure helpers): COMPLETE

Branch `feat/dpc-c3-late-policy` (from master e591457). Core only: no web, Nia, schema or deploy change in code. `late_policy` is now a known event kind, so a core at or after C3 reads, projects, previews and (through `planCommit`) writes it; no UI creates one before D2/F2 (owner gates D2.0 and F2.0 still apply: A1 must be deployed on both runtimes first).

### Tasks

- [x] C3a.1 RED `test/ledger/project.policy.test.js` (26 tests), `events.test.js` (kinds list), `events.forward.test.js` (the unknown-kind example no longer uses `late_policy`)
- [x] C3a.2 GREEN `src/ledger/events.js` (`late_policy`, restructure `waiveLate`), `src/ledger/project.js` (handler wiring), `src/ledger/tail.js` (`applyLatePolicy`, `carryOf`, waive and inheritance in `applyRestructure`), `src/ledger/preview.js` (`late_policy` draft)
- [x] C3b.1 RED `test/ledger/restructure.test.js` (19 tests), `node16.test.js` (source list, exact keys, working functions)
- [x] C3b.2 GREEN `src/ledger/restructure.js`, `src/ledger/project.js` (`prepare`, `replayLoan`, `replayLoanAt`), `index.js`
- [x] C3.CP checkpoint

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| 6fd2a37 `feat(finance-core): record mora policy changes as a late_policy event and let a restructure inherit or forgive mora` | C3a | 7 files, 362 insertions, 27 deletions |
| 613a31c `feat(finance-core): compute the arrears a restructure refinances and build its terms from the current plan` | C3b | 5 files, 312 insertions, 6 deletions |

Total vs master before this progress/tasks commit: 11 files, 674 insertions, 33 deletions = 707 changed lines (budget 2,000; each group <= 800).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| C3a.1 / C3a.2 `late_policy` | Safety net `packages/finance-core`: 29 files, 507 tests passed. First RED run: 24 failed (`EVENT_KINDS` list 1, `project.policy.test.js` 23: project, void, planCommit, validation, preview). A test bug surfaced in the same run (a void dated after `asOf` is filtered out by `project`), fixed in the test, not in the code | `project.policy.test.js` 26 tests. Triangulated: policy on the due date (1,375, 10 days, base 199,505), effective today (0, earlier payment cost unchanged, then 5 days = 687), usury then none then fixed 20% with and without voiding the middle one, storage order, grace 3 days, policy over `terms.late`, a future policy, validation of every mode, preview equals saved projection, impacted payment 190,876 to 192,251 | None needed. Mutations: inheritance of `late` removed failed 2, `late_policy` handler a no-op failed 12; both restored |
| C3a.1 / C3a.2 `waiveLate` | Same RED run: waive, inheritance and payload cases failed | Row 1 refinances 391,756, or 390,381 with `waiveLate`; `waivedLateMinor` 1,375 (0 when the mora was paid, the sum of both rows at day 30); no cost or allocation on the event; `lateMinor` of replaced rows frozen at 1,375 and `lateInterestMinor` 0; inherited policy from `terms.late` or from a `late_policy` event; explicit `none` wins; payload stores `waiveLate` only when true and rejects non-booleans | `carryOf` extracted from `applyRestructure` (the old loop and the new breakdown give the same numbers; the restructure suites are the safety net, all green). Mutations: waived amount forced to 0 failed 3, refinanced amount ignoring the waive failed 1; restored |
| C3b.1 / C3b.2 `restructure.js` | `restructure.test.js` failed at import (module did not exist); `node16.test.js` failed 3 (source list, exact keys, working functions) | `packages/finance-core`: 31 files, 552 tests passed. `restructureCarry`: golden breakdown {interest 180,876, charges 10,000, taxes 0, lateInterest 1,375}, balance 10,000,000, carried 10,192,251; equals the saved restructure's `carriedMinor` (and minus `waivableLateMinor` with waive); after a 100,000 payment; two overdue rows; due exactly on the date; before any due date; no policy; voided and later events; balance-only debt; card; frozen inputs. `buildRestructureTerms`: principal and opening date, inherited and overridden `late`, no `late` stays absent, `invalid_first_due` (equal, earlier, left over from the old plan), old grace and due day dropped, balance-only, card, `invalid_principal`/`invalid_terms`/`invalid_late`/`invalid_date`, no mutation. Preview: after balance equals the breakdown (less the mora when waived), payload over 8000 detected and refused by `planCommit`, backdated `impacted` with cost before and after cross-checked against two projections | `project()` split into `prepare`, `replayLoan` and `replayLoanAt` with no behavior change (the C2 parity suite and all project suites stayed green). Mutations: keeping the old grace failed 1, `<=` to `<` in the date check failed 1, not ignoring `undefined` overrides failed 1, doubling the waivable mora failed 3, not limiting the arrears to rows due by the date failed 6; all restored |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run packages/finance-core/test/ledger` exit 0 (part of `npx vitest run packages/finance-core`: 31 files, 552 tests passed; baseline 29 files, 507). `npx vitest run packages functions/nia src/features/debts`: 74 files, 1,111 tests passed. Full `npm test -- --maxWorkers=4`: 113 files, 1,518 tests passed on the first run (baseline before C3: 111 files, 1,473) |
| Runtime harness command/scenario and exact result | `npm run package:nia` exit 0 (core is bundled into the Nia package), `npm run build` exit 0 |
| Rollback boundary | Revert the two commits (C3b then C3a): `src/ledger/restructure.js`, `replayLoanAt`/`replayLoan`/`prepare` in `project.js`, the two barrel exports, `late_policy`/`waiveLate` in `events.js`, `applyLatePolicy`/`carryOf`/the waive and inheritance in `tail.js`, the `late_policy` kind in `preview.js`, the new tests and the unknown-kind example in `events.forward.test.js`. No stored data depends on them yet: nothing writes a `late_policy` or a `waiveLate` before D2/F1/F2. If one was written later, a bundle before A1 cannot read it (see the compatibility matrix) |

### Decisions and deviations from design

- Golden numbers: the spec says a restructure on day 10 "carries 391,756" or 390,381 with `waiveLate`. In code those are the refinanced arrears of the overdue installment (`plan[0].refinancedMinor`, principal 199,505 + charges 10,000 + interest 180,876 + mora 1,375). The carried balance (`applied[].carriedMinor`) also includes the principal still to come: 10,192,251, or 10,190,876 with the waive. Tests assert both.
- `restructureCarry(debt, events, on, opts)` takes the same `opts` as `project` (`legal`). It throws `ValidationError('restructure_unsupported')` for a card. The design assigns that code to `planCommit`/`previewChange` in F3a; the helper cannot read a card's rows, so it carries the guard already. F3a still has to add the guard to the write and preview paths.
- `restructureCarry` reads the replayed state through the internal `replayLoanAt` (not in the barrel). It returns `null` for a kind with its own projector, and the helper turns that into the typed error. `project()` was split into `prepare` + `replayLoan` to share the replay; behavior is unchanged.
- `carryOf(state, date)` (tail.js) is the single source of the carried figures: `applyRestructure` and `restructureCarry` use it. `arrears.lateInterest` is the raw sum of the unpaid mora per row, and `waivableLateMinor` clamps each row at 0 (a bank-stated mora above the accrued one never reduces what is waived).
- `waiveLate` is stored only when true and `applied[].waivedLateMinor` appears only for a waiving restructure (it can be 0). With the waive, `refinancedMinor` of a replaced row excludes the forgiven mora; the row keeps showing the mora it accrued (`lateMinor`, `lateDays`) as history, while `lateInterestMinor` and `totals.remainingLateInterest` are 0.
- The new terms inherit the mora policy in force (`state.work.late`, which includes one set by a `late_policy` event) when the restructure terms have no `late`; an explicit `late` (including `none`) wins. `modality` is not inherited at replay: `buildRestructureTerms` keeps it from the terms in force.
- `buildRestructureTerms(current, { effectiveOn, carriedMinor, overrides })`: the carried balance and the effective date always win over the overrides; `undefined` overrides are ignored; the old `grace`, `balloonMinor`, `manualPlan` and `dueDay` do not carry over (they belong to the old calendar); a scheduled plan whose first due date is not after the effective date fails with `invalid_first_due` (a balance-only system needs no date); `n` defaults to the current `n` when not overridden, so the D1 dialog must always pass it.
- `late_policy` on a card: the kind is known now, and the card projector has no handler, so the event is listed in `applied` with cost 0 and changes nothing until F3a. `planCommit` does not block it yet.
- `events.forward.test.js` used `late_policy` as its "unknown kind" example; it now uses `mora_schedule`, because `late_policy` is known from this slice on. The A1 guarantees (skip, notice, strict writer) are unchanged and still tested.
- `previewChange` previews `late_policy` with the debt's own `legal` (`debt.legal` or the code tables), like every other preview; there is no `legal` option.

### Owner gate

None new. The existing gates apply to what C3 enables: deploy A1 on web and Nia before any build that can write `late_policy` (D2.0, F2.0), and deploy web and Nia together from C2 on.

### Remaining

D1 onward (not started).


## Batch D1 (RestructureDialog in three steps, Más acciones wiring): COMPLETE

Branch `feat/dpc-d1-restructure` (from master dc78f83). Web only: no core, Nia, schema or deploy change. No live Appwrite call was made (web tests mock `src/appwrite`). No dev server was started, so the layout was not checked in a browser.

### Tasks

- [x] D1a.1 RED `wizard/fromTerms.test.js` (10 tests), `restructureModel.test.js` (23 tests)
- [x] D1a.2 GREEN `wizard/fromTerms.js`, `restructureModel.js`
- [x] D1b.1 RED `RestructureDialog.test.jsx` steps 1-2 (14 tests)
- [x] D1b.2 GREEN `RestructureDialog.jsx` steps 1-2, `wizard/steps/PlanStep.jsx` (two optional props)
- [x] D1c.1 RED `RestructureDialog.test.jsx` step 3 and saving states (10 tests), `DebtDetailContainer.test.jsx` restructure flow (7 tests; the old "lists both plan changes" test moved into it with the third item)
- [x] D1c.2 GREEN `RestructureDialog.jsx` step 3, `DebtDetailContainer.jsx` (dialog, `useCommitDialog`, `onRestructure`)
- [x] D1.CP checkpoint

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| b0227fe `feat(debts): model the restructure dialog with a terms-to-draft round trip, arrears breakdown, mora waiver and payload limit` | D1a | 4 files, 524 insertions |
| d7ad681 `feat(debts): add the restructure dialog with the arrears step and the new conditions step` | D1b | 3 files, 314 insertions, 5 deletions |
| bbf5226 `feat(debts): restructure a loan from Más acciones with a before/after summary, mora waiver and payload limit` | D1c | 4 files, 327 insertions, 14 deletions |

Total vs master before this progress/tasks commit: 9 files, 1,160 insertions, 14 deletions = 1,174 changed lines (budget 2,000; each group <= 800; D1a+D1b = 843, under the 1,400 size-review trigger).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| D1a.1 / D1a.2 `fromTerms.js` | Safety net `src/features/debts`: 33 files, 370 tests passed. `fromTerms.test.js` failed at import (module did not exist) | 10 tests: strings of a French loan with a fee and a percentage insurance (`0,05` keeps its comma), grace, balloon and manual plan; round trip `validateTerms({...terms, ...toPlanFields(fromTerms(terms)), charges})` equals the terms for six shapes (French with charges, nominal monthly rate, German with grace on principal, interest-only with balloon, manual plan, fixed mora policy with modality); blank `n` is `NaN` and the core rejects it; grace and balloon only for the systems that support them | None needed |
| D1a.1 / D1a.2 `restructureModel.js` | `restructureModel.test.js` failed at import | 23 tests: golden breakdown 10,000,000 / 180,876 / 10,000 / 1,375 with total 10,192,251 equal to the sum of the rows; taxes grouped with charges (11,900); after a 100,000 payment only 92,251 of interest is left; invalid date and a settled debt block step 1; "condonar mora" only when mora > 0 (10,190,876 carried, `waiveLate` only when set, a leftover choice ignored without mora); `n` always passed (48 gives `remainingPeriods` 48); blank `firstDueOn` follows the effective date; on or before the effective date is an inline error and `canAdvance` is false; `payloadChars` > 8000 gives `tooLarge`, no draft and the message; usury notice at 40% against the 28.59% cap; backdated `impacted` | None needed. Mutations: forgetting the waive in the carried balance failed 1, `waivable = true` failed 2, payload limit doubled failed 1, initial `n` = `terms.n` failed 1; `<` instead of `<=` in the local first-due check survived because `buildRestructureTerms` rejects an equal date with the same field message (equivalent mutant, the core backs it) |
| D1b.1 / D1b.2 `RestructureDialog.jsx` steps 1-2 | Safety net: the model suites above plus `src/features/debts` stayed green. `RestructureDialog.test.jsx` failed at import | 14 tests: arrears and mora rows with the total, another effective date (due day: no mora, 10,190,876), invalid date blocks, Atrás keeps typed values, prefill (rate, convention, French, 36, monthly, first installment 2026-03-15, grace 0, fee 10000), EA echo 26.82%, interest-only asks for the final payment and a French plan for grace (options exactly `interest_only`, `french`), no manual plan for a family loan, inline first-due error with `aria-invalid` and Siguiente disabled, blank `n`, waive checkbox only with mora and the refinanced balance line, wrong charge blocks the step | None needed. Mutations: waive checkbox always shown failed 1, dropping `systems`/`invalid` failed 2, silencing the issue messages failed 3, a submit that ignores `ready` survived until one more test submitted the form another way (added) and then failed 1 |
| D1c.1 / D1c.2 step 3 | 8 failed in the first RED run (no step 3: no preview group, no note, no alert) | `RestructureDialog.test.jsx` 24 tests: before/after rows (Saldo 10,000,000 to 10,192,251; Vencido 391,756 to 0; Mora 1,375 to 0; Cuotas 36 to 48; Próxima cuota 380,381 to 319,488 checked against `buildSchedule`), draft sent with `terms` and no `waiveLate`, waive sends `waiveLate: true` and shows "Mora condonada $ 1.375", usury notice at 40% never blocks, no notice under the cap, backdated notice names the 20 feb payment, `payload_too_large` (terms padded to 7,995 characters) shows the message and disables save, back and forth, saving and failed states keep the summary | None needed. Mutations: no backdated notice failed 1, no usury notice failed 1, no `preview.issue` failed 1, no waived-mora row failed 1 |
| D1c.1 / D1c.2 wiring | 7 container tests failed (no menu item) | `DebtDetailContainer.test.jsx` 38 tests (7 new): loan menu lists three items, nothing written before the summary is confirmed, one `restructure` event with `de` + nonce id, `web:n1` key, amount 0, new terms in the payload and no cost row; reload, then reconcile on fresh events, then refresh with "Se actualizaron 2 filas"; double tap one event; failed write keeps the summary and the retry reuses id and key; reconcile failure keeps the save; end to end: the event written by the dialog is read back, its void asks for the confirmation, and a later payment blocks it naming "el pago del 20 feb" with nothing written. The card container test (exactly two items) stays green | None needed. Mutation: dropping `afterSave` from the restructure failed 2 |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run src/features/debts` exit 0: 36 files, 433 tests passed (baseline before D1: 33 files, 370). Full `npm test -- --maxWorkers=4`: 116 files, 1,581 tests passed on the first run (baseline before D1: 113 files, 1,518) |
| Runtime harness command/scenario and exact result | `npm run build` exit 0 (`DebtsContainer-*.js` emitted). `npm run package:nia` not required for D1 (no core or Nia change) |
| Rollback boundary | Revert the three commits (D1c, D1b, D1a): `RestructureDialog.jsx`, `restructureModel.js`, `wizard/fromTerms.js` with their tests, the `restructure` dialog and `onRestructure` in `DebtDetailContainer.jsx`, and the `systems`/`invalid` props of `PlanStep.jsx`. No stored data depends on them: the event kind, the guarded void and the reconcile were already in place |

### Decisions and deviations from design

- `fromTerms(terms)` returns the plan fields with the wizard state's names (`rate`, `system`, `periodicity`, `n`, `firstDueOn`, `grace`, `balloon`, `manualPlan`) plus `chargeRows` (drafts of the charges editor). `toPlanFields(draft)` is its inverse (an export beyond the design) and the round trip is tested against `validateTerms`. A manual plan round-trips even though the dialog never offers one.
- The initial form is `fromTerms(projection.terms)` with four changes: the effective date is today, `n` is the installments still to pay (`projection.remainingPeriods`, else the current `n`), `firstDueOn` is blank (follows the effective date: one period later) and grace, balloon and manual rows are reset (they belong to the old calendar). `n` is always sent as an override, as C3 asked.
- `PlanStep` is reused as is for the plan fields. It gained two optional props: `systems` (the dialog leaves out the manual plan, so a family or "other" debt gets no system select) and `invalid` (marks `n`, `firstDueOn`, grace and balloon with `aria-invalid`; the dialog shows the messages in `role="alert"` lines).
- The effective date ("Vigente desde") is in step 1 because the arrears depend on it. "Condonar los intereses de mora" is in step 2 (spec), with a running "Saldo que se refinancia" line; step 1 always shows the unwaived total (the sum of its rows), and the waived balance appears in step 2 and in the step 3 summary.
- Step 3 shows the new plan (rate echo, system, installments, first installment, waived mora) and a before/after table: Saldo, Vencido, Mora por pagar (only when mora exists before or after), Próxima cuota, Cuotas restantes, Intereses por pagar, Última cuota. The usury notice (informational, from `debt.legal` through `rateEcho`) and the backdated notice (`impacted` payments) sit above the table.
- `payload_too_large` is shown as a Spanish message ("Esta reestructuración es demasiado grande...") and `previewRestructure` returns no draft, so the save stays disabled; the code itself is not displayed.
- "Reestructurar" is wired only for a loan with installments (`system !== 'none'`): a card never gets it (the menu also filters it), and an informal balance-only debt has no plan to replace. The spec only says "loans only"; this narrows it for `none`.
- The new terms start from the terms in force today (`projection.terms`) even for a backdated effective date; the core rebuilds the carried balance at replay (AD13), so only the rate, charges and mora policy come from today's terms.
- In the D1b commit the dialog is complete for steps 1-2 but not mounted anywhere, and its last step has no body yet; D1c adds step 3 and the wiring. The commit is green and unreachable by users.
- `MAX_PERIODS` (2000) is duplicated in `restructureModel.js` because the core barrel does not export it; the core still has the last word.
- The guarded void flow (`voidRuleOf`, `VoidDialog`, the container reconcile) came with B1/B2; D1c adds an end-to-end test over an event written by the new dialog instead of new production code.

### Owner gate

None for D1 (no schema, no deploy order). D2 still has its own gate (D2.0: A1 deployed on web and Nia) and was not started.

### Remaining

D2 onward (not started; D2.0 is an owner gate).

## Batch E1 (Nia `legal_rate`: extraction, preview, Confirm with update on 409): COMPLETE

Ran before D2 because D2 is gated by the owner (D2.0: A1 deployed on web and Nia). E1 depends only on A2, so the order is safe. Branch `feat/dpc-e1-nia-legal` (from master ea28fd8, which already holds A to D1).

### Tasks

- [x] E1a.1 RED `functions/nia/debt/legal.test.js` (54 tests in total after E1b), `extract.test.js` (6 new): "la usura de noviembre es 28.2" gives usury 2820 bp, `consumer`, 2026-11; month without year resolves within 6 months of today; 2.82 refused; preview echoes kind, modality, month, value; the model extracts the phrase only
- [x] E1a.2 GREEN `functions/nia/debt/legal.js`, `extract.js`; plus the shared `legalRateId` and `legalValueInRange` in `packages/finance-core/src/legal.js` (barrel, exact keys test), imported by `src/appwrite.js`
- [x] E1b.1 RED `handler.test.js` (17 new), `pending.test.js` (1 characterization), `legal.test.js` (`isStorableLegalRate`, `describeLegalRate`), `index.test.js` wiring (4 new): Confirm writes once; a second Confirm leaves one row; an existing row updates and is reported as an update (409 then `deps.updateRow`); nothing is written before Confirm; pending under 300 bytes; row permissions `read` + `update`; `PATCH /rows/{id}`
- [x] E1b.2 GREEN `handler.js`, `pending.js` (type comment only), `index.js` (`DEBT_ROW_ACTIONS.legal_rates`, `updateRow` in `debtDeps`, classifier text)
- [x] E1.CP checkpoint

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| 5a4d4b6 `refactor(core): share the legal rate row id and value range between the web and Nia` | E1a (shared core) | 5 files, 106 insertions, 17 deletions |
| d352cb7 `feat(nia): read a legal rate from a message with the month resolved in code, range guards and a preview` | E1a | 4 files, 414 insertions, 3 deletions |
| d02512b `feat(nia): confirm a legal rate once, update the existing row on a repeated key, and grant the row team update` | E1b | 8 files, 402 insertions, 17 deletions |

Total vs master before this progress/tasks commit: 15 files, 917 insertions, 32 deletions = 949 changed lines (budget 2,000; each group <= 800). Net growth is smaller than the sum of the commits because `legal.js` and `legal.test.js` were touched by two of them.

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| E1a shared core `legalRateId` / `legalValueInRange` | Safety net `functions packages src/appwrite.test.js`: 42 files, 792 tests passed. `legal.row.test.js` 7 failed (`legalRateId is not a function`) | 7 tests: id `lruco202611household-test`, `lrico...`, `lrumg202612...`, `lrsal202701...`, each modality code, cut at 25 characters of household, same key same id; value ranges 500..10000 bp and 100,000..100,000,000 pesos with edges, fractional and string refused, unknown kind refused. `src/appwrite.test.js` stays green (its old `legalRateId` and range tests pass through the core). `packages` 559 tests green | `src/appwrite.js` lost its own id tables, ranges and `isOwn`; `legalRateId` is now a wrapper that defaults the household |
| E1a.1 / E1a.2 `legal.js` | `legal.test.js` failed at import (module did not exist); 6 `extract.test.js` cases failed (action fell back to `list`) | `legal.test.js` 43 tests at this point: 7 month resolutions on both sides of today, tie goes to the past, explicit year, accents/abbreviations/numbers/`YYYY-MM`, bad months and years; usury 28.2 gives 2820, February in a leap year, IBC 19.49 gives 1949, `"28,2"`, Spanish modality names, unknown modality, 9 refused values, edges 5 and 100, mortgage IBC refused, missing/invalid month; SMMLV year/default year/refusals; missing kind and value; preview echo, IBC-derived cap 19.49 gives 29.24 and 19.06 gives 28.59, no cap for mortgage. `extract.test.js` 6 tests including the prompt wording | Mutations: tie `<` to `<=` failed 1; mortgage code removed failed 1; two-decimal check removed failed 1; the mortgage guard in the preview survived until one more test was added, then failed 1 |
| E1b.1 / E1b.2 handler | 17 failed in the first RED run (`world()` gained `updateRow`; no `legal_rate` action) | `handler.test.js` 74 tests (17 new): preview with nothing written and a 300-byte pending; Confirm row (id `lruco202611h1`, basis points, `verified: false`, author); second Confirm "ya estaba registrad"; same pending confirmed twice before the done marker leaves one row; 409 then `updateRow` reported as "actualicé"; other month/modality is another row; failed update keeps the pending; IBC preview with derived cap; SMMLV for a year; month resolution in the preview; 2.82 refused with `pending` kept null; SMMLV range and mortgage IBC refusals; missing fields; legal rates unreadable still previews; tampered pending refused; wrong-stage button ignored | Mutations: always "registré" failed 1; storable check disabled failed 1; `verified: true` failed 2; missing-field question disabled failed 1 |
| E1b.1 / E1b.2 `pending.js` | `pending.test.js` legal rate case | Characterization of the generic `buildPending` (both a monthly and a yearly draft stay under 300 bytes). It passes before and after because the payload builder is generic; the real contract is covered by the handler and wiring tests. Triangulation skipped for the type comment | None needed |
| E1b.1 / E1b.2 `index.js` wiring | 3 of 4 wiring tests failed (permissions `read` only, no `updateRow` in the deps) | `index.test.js` 13 tests (4 new): classifier prompt names the legal rate; preview then Confirm writes one row with `read("team:t1")` and `update("team:t1")` and three Confirms (one repeated update) keep one row; existing key goes through `PATCH /rows/lruco202611h1` and is reported as an update; 2.82 writes nothing | None needed |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run functions scripts` exit 0: 16 files, 328 tests passed (baseline for `functions packages src/appwrite.test.js` before E1: 42 files, 792). Full `npm test -- --maxWorkers=4`: 118 files, 1,670 tests passed on the first run (baseline before E1: 116 files, 1,581) |
| Runtime harness command/scenario and exact result | `index.test.js` runs the real entry point against a fake `undici.fetch` (Appwrite, Telegram, Gemini): preview, Confirm, repeated Confirm, `PATCH`. `npm run build` exit 0. `npm run package:nia` exit 0 (`functions/nia.tar.gz` written, ignored by git) |
| Rollback boundary | Revert d02512b (handler, pending comment, index wiring), then d352cb7 (`legal.js`, extraction), then 5a4d4b6 (core id and range). Reverting only d02512b leaves `legal_rate` extracted and previewed but not confirmable (its pending would reach the pay commit and answer that the debt was not found), so revert E1b and E1a together. No stored data depends on them: the table and its unique index are A2, and rows written from Nia are ordinary `legal_rates` rows that the web reads |

### Decisions and deviations from design

- The design named the seam `debtUpdateRow`. The existing `updateRow(table, rowId, data)` already is the `PATCH /rows/{id}` helper, so `debtDeps()` passes it as `updateRow` and no new function was added.
- `legalRateId` and `legalValueInRange` live in `packages/finance-core/src/legal.js` and the barrel (two new public keys). `src/appwrite.js` keeps exporting `legalRateId(key, householdId = configured)` as a thin wrapper so its callers and tests do not change. The kind/modality validity check in `assertLegalRow` now uses `['ibc','usury','smmlv']` and `'all'` plus `LEGAL_MODALITIES`, which is the same set as the old code tables.
- Values: the model sends the percent as the user said it (28.2) and code stores basis points (2820); a value with more than two decimals is refused with the same message as an out-of-range one. SMMLV is whole pesos, numbers only.
- A month without a year resolves to the year that puts it within 6 months of today. At an exact 6-month distance the past wins (October 2026 + "abril" gives April 2026), because a cap is certified before it is typed in. The preview always shows the resolved year.
- Not asked in the spec, chosen here: the modality defaults to consumer; the month is required for IBC and usury (it is asked, never defaulted); an SMMLV without a year means this year; a mortgage IBC is refused with an explanation, because an IBC never derives a mortgage cap.
- Exactly-once: the row id is the key. There is no event, so `debt:{pendingId}` is not used; the existing done marker (`pending.done`) answers "ya estaba registrada" and a retry before the marker is saved collides (409) into an update with the same values, which leaves one row.
- Rows written from Nia carry `source: 'Nia (Telegram)'` and `verified: false`, so an update from Nia of a verified row clears the verified flag (the usury notice then adds "no verificado oficialmente").
- Confirm re-checks the draft with `isStorableLegalRate` because the pending comes back from the session, not from the reader.
- The preview does not say whether the key already has a row; Confirm reports "actualicé" instead of "registré" when it does. The design asks for the report, not a pre-read.
- Nia's reply shows the resolved legal phrase, for example "la tasa de usura (consumo y ordinario) de noviembre de 2026: 28.20% E.A.".

### Owner gate

None for E1. Rows written from Nia need the `legal_rates` table (A2, `npm run migrate:appwrite`) and the new Nia tarball (`npm run package:nia`). Without the table the preview works and Confirm fails with the generic Nia error. D2 still has its own gate (D2.0: A1 deployed on web and Nia) and was not started; E2 was not started either.

### Remaining

E2 onward and D2 (not started; D2.0 is an owner gate).

## Batch E2 (Nia `rate_change` and `charge_change`: previews, mode and convention callbacks, exactly-once): COMPLETE

Ran after E1 and still before D2 (D2 stays gated by the owner, D2.0). Branch `feat/dpc-e2-nia-changes` (from master e34e354, which already holds A to D1 and E1). No live Appwrite, Gemini or Telegram call was made; the wiring tests run the real entry point against a fake `undici.fetch`. `.env` was never read.

### Tasks

- [x] E2a.1 RED `planChange.test.js`, `extract.test.js`: extraction of `planChange{effectiveOn, mode}` plus the rate; effective date default today; preview EA echo (`2% MV ≈ 26.82% EA`), household cap usury notice (cap 29, 30% EA still previews), `installment_too_low` explained with `keep_term` shown; cards skip the mode. Reqs NI2, NI7
- [x] E2a.2 GREEN `functions/nia/debt/planChange.js` (new), `extract.js`, `preview.js` (`usuryLines`, `conventionQuestion` extracted for reuse)
- [x] E2b.1 RED `pending.test.js`, `handler.test.js`, `index.test.js`: `nia:mode:*` (25 bytes), mode asked only for French loans, `nia:conv:*` routed by `CONVENTION_NEXT[pending.action]`, stale buttons ignored with a short message and no write, event id `de{id}`, key `debt:{id}`, "ya estaba registrado", double Confirm and race one event, pending under 1.5 KB. Reqs NI5, NI8, NI2
- [x] E2b.2 GREEN `pending.js` (`modeKeyboard`, `parseCallback`), `handler.js` (`CONVENTION_NEXT`, `continueRate`, `commitRateChange`), `index.js` (callback regex, classifier text)
- [x] E2c.1 RED charge change: match by label/kind ignoring case and accents; removal previews the removed charge (and dependents) and the next installment; adding refused with a web pointer before any debt lookup; backdated note when `impacted.length > 0`; charges rebuilt from the live debt at Confirm. Reqs NI2, NI6
- [x] E2c.2 GREEN `planChange.js`, `handler.js`, `pending.js` (`chargeKeyboard`, `nia:chg:`), `extract.js`, `index.js`
- [x] E2.CP checkpoint

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| df9cb88 `feat(nia): read a rate change from a message and preview it with the core replay, EA echo, usury notice and backdated note` | E2a | 5 files, 352 insertions, 10 deletions |
| 0e20578 `feat(nia): confirm a rate change once from mode and convention buttons, and ignore stale buttons` | E2b | 8 files, 465 insertions, 17 deletions |
| 06ad32c `feat(nia): change or remove an existing insurance or charge with a preview of the next installment, and send additions to the web` | E2c | 10 files, 770 insertions, 20 deletions |
| 1ef4bf4 `docs(nia): document the legal rate, rate change and charge change actions` | docs | 1 file, 5 insertions, 2 deletions |

Total vs master before this progress/tasks commit: 12 files, 1,570 insertions, 27 deletions = 1,597 changed lines (budget 2,000; each group <= 800: E2c is 790).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR / mutation |
|---|---|---|---|
| E2a.1 / E2a.2 extraction | 7 `extract.test.js` cases failed (action fell back to `list`, prompt without `rate_change`) | `extract.test.js` 40 tests incl. the new `rate_change` block | None needed |
| E2a.1 / E2a.2 preview | `planChange.test.js` failed at import (module did not exist) | 14 tests: lower rate keeps term (installment, remaining periods, interest before and after, from the core), `keep_installment`, household cap 29.00 with a 30% EA rate, unavailable-tables line, `installment_too_low` falls back to `keep_term` with the explanation, non-French downgrade note, card without mode, backdated note only when a payment's cost changes, unreadable debt, read-only | Mutations: backdated note always on failed 1; fallback condition disabled failed 1. `usuryLines` extracted from `noticeLines` (the create preview tests stayed green) |
| E2b.1 / E2b.2 pending | `pending.test.js` failed (no `modeKeyboard`, `parseCallback` returned null for `nia:mode:`) | 4 new tests: both buttons <= 25 bytes, only `keep_term` offered for non-French, parse and refuse other modes, 6-candidate and full-draft pendings under 1.5 KB | None needed |
| E2b.1 / E2b.2 handler | 22 failed in the first RED run (no `rate_change` route, no `mode` stage) | `handler.test.js` 110 tests (about 21 for rate change): mode question for French, preview after the button, straight to preview when the mode was said or the system has no choice, card sends `keep_term`, convention then mode then preview, create convention still works, pick then continue, missing rate, `installment_too_low`, household cap, backdated note, Confirm writes one event with ids `dep1` / `debt:p1`, "ya estaba registrado" on retry and tap, race writes one, rebuild with a payment recorded after the preview, debt gone, `keep_installment` no longer viable at Confirm writes nothing and suggests `keep_term`, premature Confirm, three stale-button cases | Pre-existing handler tests all green. Mutation on the rate path not needed (each branch has its own test) |
| E2b wiring | 3 `index.test.js` wiring tests failed (classifier text, `nia:mode` not routed) | `index.test.js`: classifier and extractor prompts, mode buttons, preview, three Confirms write one event, stale mode button after confirm | None needed |
| E2c.1 / E2c.2 pure | `planChange.test.js` and `extract.test.js` charge blocks failed (imports missing / action fell back to `list`) | `readChargeChange`, `chargesInForce` (loan = terms; card folds active events up to today, ignores voided and future), `findCharge` (label, words, kind, several, none), `rebuildCharges`, `previewChargeChange` (remove, set, dependents, ask which, none, no charges, same value, fixed decimals, over 100, backdated note, card, unreadable), `describeChargeChange` | Mutations: removal without dependents failed 3; same-value check removed failed 1. A test fixture hard-coded `$ 10.000` with a plain space (Intl uses a no-break space): changed to `pesos()` |
| E2c.1 / E2c.2 handler | 41 failed in the combined RED run (charge action unknown, no `nia:chg:`) | `handler.test.js` 110 tests (about 13 for charge change): removal preview with a pending under 400 bytes, add refused with the web pointer and no debt lookup, missing fields, no match lists the charges, several matches use `nia:chg:` buttons, bad or out-of-turn button ignored, debt pick then continue, backdated note, card, Confirm writes the rebuilt set (IVA goes with the fee), double tap and race write one event, web change after the preview is kept, charge or debt gone writes nothing | Mutation: removing the dedupe pre-check at Confirm survived all tests, so a test was added (repeat Confirm of a removal says "ya estaba registrado", not "ya no existe"); the mutation then failed 1 |
| E2c wiring | `index.test.js` wiring failed once `chg:` was taken out of the callback regex | 3 wiring tests: classifier text, which-insurance buttons, preview, repeated Confirm writes one event, stale `nia:chg` after confirm, add refused | None needed |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run functions` exit 0: 12 files, 367 tests passed. Full `npm test -- --maxWorkers=4`: 119 files, 1,766 tests passed on the first run (baseline before E2: 118 files, 1,670 tests) |
| Runtime harness command/scenario and exact result | `index.test.js` runs the real entry point against a fake `undici.fetch` (Appwrite, Telegram, Gemini). `npm run build` exit 0. `npm run package:nia` exit 0 (`functions/nia.tar.gz` written, ignored by git; the packaging scan found no Node 16 incompatibility) |
| Rollback boundary | Revert 06ad32c (charge change), then 0e20578 (rate change callbacks and Confirm), then df9cb88 (extraction and preview); the README commit is independent. Reverting only 0e20578 leaves `rate_change` extracted and previewable by the pure layer but unrouted in the handler (its action would fall to the analysis branch), so revert E2c and E2b together, or all three. No stored data depends on them: Nia writes ordinary `rate_change` and `charge_change` events that the web reads and voids |

### Decisions and deviations from design

- Extraction: the new rate rides in the existing `rate` field (value, period, compounding, timing), so the convention rules and the `nia:conv:` buttons are the same as for a new loan. `planChange` holds `effectiveOn`, `mode`, and for charges `chargeRef`, `op` (`set`, `remove`, `add`) and `newValue`. The design listed more fields (`n`, `system`, `periodicity`, `firstDueOn`, `waiveLate`) for restructure; they belong to F1 and were not added.
- A new callback `nia:chg:{index}` (not in the design) chooses between several matching charges. The button carries the position in `pending.candidates` because charge ids can be long and a callback holds 64 bytes; the candidate charge ids ride in the pending (under 1.5 KB for six). The callback regex in `index.js` gained `mode:` and `chg:`.
- `installment_too_low`: instead of a second button, Nia explains and shows the `keep_term` preview directly (as the web pre-selects it); the pending then holds `keep_term`. At Confirm, if `keep_installment` is no longer viable on the live debt, nothing is written and Nia asks to repeat the request choosing `keep_term`.
- Mode: asked only when the debt is a French loan and the user did not say it. A `keep_installment` said for a non-French loan is downgraded with a one-line note; a card always sends `keep_term`.
- Charge change: removal with dependents (`pctOfCharge`) is confirmed through the preview, which lists what goes with the removed charge (IVA with a fee); it is not refused. Setting a value: a fixed charge needs whole pesos, a percentage must be at most 100, and the same value is answered with "ya tiene ese valor". The charges in force are folded for cards like the web's `chargesInForce` (re-implemented in `planChange.js`, since `functions/` cannot import from `src/`).
- Charge Confirm checks the dedupe key first (`findEventByDedupe`): after a removal the charge is gone from the live debt, so rebuilding first would answer "ya no existe" to a retry instead of "ya estaba registrado".
- The backdated note uses the design's wording ("Los costos de pagos anteriores se actualizarán cuando abras la deuda en la web."), also appended to the Confirm reply.
- The pending of a rate change keeps `{effectiveOn, rate, mode}` (about 150 bytes) and a charge change `{effectiveOn, chargeId, op, newValue}` (under 400 bytes with the envelope); everything else is rebuilt from the live debt at Confirm.
- `functions/nia/README.md` documented only five actions; the table now has eight, including `legal_rate` from E1.

### Owner gate

Deploy the new Nia tarball (`npm run package:nia`) with or after the web build. No schema change in E2. D2 still has its own gate (D2.0: A1 deployed on web and Nia) and was not started; F* not started.

### Remaining

D2 (owner gate D2.0), then F1-F3.

## Batch F1 (Nia restructure: overrides-only pending, rebuild at Confirm, waiveLate, exactly-once): COMPLETE

Branch `feat/dpc-f1-nia-restructure` (from master 9fa3b90). No live Appwrite, Gemini or Telegram was touched; `.env` was never read.

### Tasks

- [x] F1a.1 RED `planChange.test.js`, `extract.test.js`: overrides-only pending within 1.5 KB; terms rebuilt from the live debt (a payment after the preview changes the carried balance 10,192,251 to 10,092,251); invalid terms, a card, no balance, a payload over 8000 characters all return an explanation and no draft; `waiveLate` (10,190,876 carried, 390,381 refinanced). Reqs NI3
- [x] F1a.2 GREEN `functions/nia/debt/planChange.js` (`readRestructure`, `restructureDraft`, `rebuildRestructure`, `previewRestructure`, `describeRestructure`), `extract.js` (action, schema, prompt, `restructure` branch), `preview.js` (labels exported for reuse)
- [x] F1b.1 RED `handler.test.js`, `index.test.js`: "reestructura a 48 cuotas, primera cuota 2026-12-05" previews the arrears (with mora), carried balance, new installment, term and usury notice; the convention buttons for an ambiguous rate; pick; Confirm writes one `restructure` (`dep1`, `debt:p1`); payment between preview and Confirm; double tap and race write one; dedupe key checked before rebuilding; invalid terms, payload over 8000, card and missing debt write nothing; backdated note; stale buttons. Reqs NI3, NI6, NI7, NI8
- [x] F1b.2 GREEN `handler.js` (`startRestructure`, `continueRestructure`, `commitRestructure`, `withStatedRate`), `pending.js` (type doc), `index.js` (classifier text), `functions/nia/README.md`. `preview.js` needed no further change (its labels were exported in F1a)
- [x] F1.CP checkpoint

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| 38679e6 `feat(nia): read a restructure from a message and rebuild its terms from the live debt, with the arrears breakdown and waiveLate` | F1a | 5 files, 482 insertions, 13 deletions |
| 9b6cadc `feat(nia): preview and confirm a restructure once, rebuilt from the live debt at Confirm, and refuse cards` | F1b | 6 files, 390 insertions, 16 deletions |

Total vs master before this progress/tasks commit: 11 files, 872 insertions, 29 deletions = 901 changed lines (budget 2,000; each group <= 800: F1a is 495, F1b is 406; design 650, worst case 1,300).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR / mutation |
|---|---|---|---|
| F1a.1 / F1a.2 extraction | 6 `extract.test.js` cases failed (action fell back to `list`, no `restructure` in the prompt) | `extract.test.js` 49 tests incl. the new `restructure` block: term, first due date, system, periodicity and waiveLate read; invalid ones dropped to null; `term` missing for 0, 12.5 or no planChange; rate in `rate` with the convention rules (ambiguous gives `needsConvention`, negative gives `invalid_rate`, zero accepted); charges kept only when stated | `SYSTEMS` moved to `planChange.js` and imported by `extract.js` (one list) |
| F1a.1 / F1a.2 pure | 23 `planChange.test.js` cases failed (imports missing, so each call threw) | 59 tests in the file: `readRestructure`, `restructureDraft` (pending with 6 charges and every override stays under 1,500 bytes), `previewRestructure` golden (carried 10,192,251; overdue 391,756; mora 1,375; installment, remaining periods, interest and cost compared with the core pieces), `waiveLate` (10,190,876 and 390,381), rate echo `2.5% MV ≈ 34.49% EA` with the household cap 29, system and periodicity overrides, default first due date one period after the effective date, backdated note, card, early first due date, invalid periodicity, missing n, no balance, unreadable debt, `rebuildRestructure` after a payment (10,092,251), written terms and payload, 90 charges over 8000 characters, `describeRestructure` | Mutations: waiveLate not subtracted failed 3; payload check disabled failed 1; default first due date set to the effective date failed 1; terms and overdue measured on today instead of the effective date survived, so a backdated-restructure test was added and then failed 1 |
| F1b.1 / F1b.2 handler | 20 `handler.test.js` cases failed (action unknown, no route, no commit) | `handler.test.js` 130 tests (20 for restructure): preview text and a pending of `{effectiveOn, n, firstDueOn}` under 300 bytes, mora shown and forgiven, usury notice, convention buttons then preview, missing n, early first due date, card, pick, charges kept, Confirm writes one `restructure` (`dep1`, `debt:p1`, principal 10,180,876) and reports it, waiveLate written, payment between preview and Confirm writes 9,800,495, double tap and race write one, dedupe key before rebuild, invalid terms, 90 charges, card or missing debt, premature Confirm, backdated note, stale buttons | Mutations: dedupe pre-check removed failed 1; waiveLate not applied failed 2. `withStatedRate` extracted so `rate_change` and `restructure` share the convention routing (the 110 earlier handler tests stayed green) |
| F1b wiring | 1 `index.test.js` case failed (classifier text did not mention reestructurar) | `index.test.js` 21 tests: classifier and extractor prompts; the real entry point previews and three Confirms write one event | None needed |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run functions` exit 0: 12 files, 419 tests passed (baseline for `functions/nia/debt` before F1: 11 files, 348 tests). Full `npm test -- --maxWorkers=4`: 119 files, 1,818 tests passed on the first run (baseline before F1: 1,766) |
| Runtime harness command/scenario and exact result | `index.test.js` runs the real entry point against a fake `undici.fetch` (Appwrite, Telegram, Gemini): the restructure preview and the repeated Confirm. `npm run build` exit 0. `npm run package:nia` exit 0 (`functions/nia.tar.gz` written, ignored by git; the packaging scan found no Node 16 incompatibility) |
| Rollback boundary | Revert 9b6cadc (handler route, Confirm, README, classifier text), then 38679e6 (extraction and the pure rebuild). Reverting only 9b6cadc leaves `restructure` extractable and previewable by the pure layer but unrouted in the handler (the action would fall to the analysis branch). No stored data depends on them: Nia writes ordinary `restructure` events that the web reads and the core replays |

### Decisions and deviations from design

- Extraction: the restructure fields ride in `planChange` (`effectiveOn`, `n`, `system`, `periodicity`, `firstDueOn`, `waiveLate`) as the design lists; the new rate rides in the existing `rate` field, so the convention rules and the `nia:conv:` buttons are the same as for a new loan and a rate change, and the optional charge set rides in the top-level `charges` already used by create (they replace the current ones; removing all charges through a restructure is not expressible from Nia, use a charge change first).
- `n` is required (asked as "el número de cuotas" when missing) because `buildRestructureTerms` does not carry the old plan shape and the old `n` would restart the original term. A first due date that was not said is one period after the effective date (`periodDates`), because the carried `firstDueOn` is in the past; the preview states it.
- The terms in force and the overdue figure are measured on the effective date (not on today), the same date `restructureCarry` uses; a backdated restructure therefore shows what it refinances on that date.
- "Cuotas vencidas que se refinancian" is the projection's past-due amount at the effective date (391,756 in the golden case, 390,381 with waiveLate); the breakdown lines come from `restructureCarry`.
- Confirm checks the dedupe key before rebuilding (E2 lesson): once written, the restructure changes the debt that a repeated Confirm would rebuild from.
- The pending cannot exceed 1.5 KB through extraction (6 charges of at most 40 characters stay near 1.3 KB), so `pending_too_large` is not caught for a restructure; the test of the pure `restructureDraft` with the largest possible set guards the limit.
- Task F1b.2 lists `preview.js`: it was edited in F1a (labels exported) and needed nothing more; the new core error codes already had a path through `restructureIssue` in `planChange.js`, so `CORE_MESSAGES` was not extended.
- A card with an ambiguous rate is asked for the convention before the refusal (the refusal comes from the core when the preview is built). Cosmetic; no write happens either way.

### Owner gate

Deploy the new Nia tarball (`npm run package:nia`) with or after the web build; a Nia that writes `restructure` needs the web at or after C3 and D1 to void or read it as designed. No schema change in F1. D2 (owner gate D2.0), F2 (A1 deployed on Nia) and F3 were not started.

### Remaining

D2 (owner gate D2.0), then F2 and F3.

## Batch D2 (mora UI: wizard, detail, payment, LatePolicyDialog): COMPLETE, MERGE HELD (owner gate D2.0 open)

Branch `feat/dpc-d2-mora-ui` (from master cb09a35). No live Appwrite was touched and no dev server was started; `.env` was never read.

### Owner gate (D2.0, left unchecked)

D2 is implemented on its branch but MUST NOT be merged or deployed until the owner confirms D2.0: A1 (the forward-compatible reader) is deployed on BOTH web and Nia. This build can write `terms.late` (the wizard) and `late_policy` events (the dialog); an older bundle without A1 would not read them. Deploy order: A1 on web and Nia first, then this build.

### Tasks

- [ ] D2.0 GATE (owner): open, see above
- [x] D2a.1 RED `lateModel.test.js`, `wizardModel.test.js`, `DebtWizard.test.jsx`: mora select defaults (family and other none, consumer, vehicle and mortgage usury); `fixed` asks for a rate and blocks Siguiente; the default is written into the created terms (none writes nothing); an invalid mora is explained in the plan step
- [x] D2a.2 GREEN `lateModel.js` (draft model), `LateFields.jsx` (shared inputs), `wizardModel.js`, `PlanStep.jsx` (`withLate`), `DebtWizard.jsx`, `RateField.jsx` (`valueLabel`)
- [x] D2b.1 RED `DebtDetail.test.jsx`, `PlanTable.test.jsx`, `debtDetailModel.test.js`, `paymentModel.test.js`, `PaymentDialog.test.jsx`, `DebtDetailContainer.test.jsx`, `DebtsContainer.test.jsx`: mora figure, Mora column (1,375, 10 days, base 199,505), totals with mora, `late_cap_stale` with the Ajustes link, `late_cap_unknown`, `late_mortgage_unverified`, 390,381 at day 10 previews 10,000 / 1,375 / 180,876 / 198,130 with cost 192,251 (also through the container: one event and one cost row of 192,251 on a double tap), `late_policy` history line
- [x] D2b.2 GREEN `DebtDetail.jsx`, `LateNotices.jsx`, `PlanTable.jsx`, `debtDetailModel.js` (`cost.lateMinor`), `paymentModel.js` (`lateMinor`), `PaymentDialog.jsx`, `DebtDetailContainer.jsx`, `DebtsContainer.jsx` and `FinanceShell.jsx` (`onOpenSettings` / `onNavigate`), `debtFixtures.js`. `eventSummary.js` needed no change: its `late_policy` summary shipped in B1/C3 and the detail test now covers it
- [x] D2c.1 RED `latePolicyModel.test.js`, `LatePolicyDialog.test.jsx`, `DebtDetailContainer.test.jsx`: effective 10 days ago previews mora 1,375 and saves one `late_policy`; effective today shows 0; stale and unknown notices; `contract_multiple` (0 < m <= 3); `graceDays`; past-date warning; afterSave reconcile
- [x] D2c.2 GREEN `latePolicyModel.js`, `LatePolicyDialog.jsx`, `DebtDetailContainer.jsx` (loans only). `MoreActionsMenu.jsx` already listed "Configurar mora" (B2) and needed no change
- [x] D2.CP checkpoint

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| 5599c78 `feat(debts): choose the mora policy in the new-debt wizard, preset by kind, and save it in the created terms` | D2a | 9 files, 356 insertions, 7 deletions |
| 739fdad `feat(debts): show mora in the debt detail, plan table, cost and payment preview, with the legal cap notices and a link to Ajustes` | D2b | 17 files, 335 insertions, 19 deletions |
| d8bcb8b `feat(debts): configure the mora policy from Más acciones with a live preview as of today, written as one late_policy event` | D2c | 6 files, 612 insertions, 2 deletions |

Total vs master before this progress/tasks commit: 30 files, 1,302 insertions, 27 deletions = 1,329 changed lines (budget 2,000; each commit <= 800: D2a is 363, D2b is 354, D2c is 614; design 850, worst case 1,700).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR / mutation |
|---|---|---|---|
| D2a.1 / D2a.2 model | `lateModel.test.js` failed at import; 7 `wizardModel.test.js` cases failed (no `late` in the state, nothing written) | `lateModel.test.js` 10 tests (defaults by kind, draft to core input, blank grace is 0, missing versus invalid messages, grace ignored while the mode is none) and `wizardModel.test.js` 71 incl. 8 new | Mutation: the `terms.late` write disabled failed 5 |
| D2a.1 / D2a.2 UI | 5 `DebtWizard.test.jsx` cases failed (no mora select) | 16 tests: usury preset saved, family none saved without a policy, fixed blocks until a rate is typed and saves it with 5 grace days, grace 120 blocks with a message and turning mora off recovers, the wizard offers three modes (the multiple is not in the wizard, per the design) | `LateFields` extracted so the dialog reuses it |
| D2b.1 / D2b.2 payment | 3 `paymentModel.test.js` cases failed (no `lateMinor`; one expected total corrected to 391,756 + 390,381 after reading `dueNow`) | 11 tests: day-10 split 10,000 / 1,375 / 180,876 / 198,130, cost 192,251, no policy gives 199,505 and cost 190,876; `PaymentDialog.test.jsx` 7; container: one event and one cost row of 192,251 on a double tap | Mutation: mora folded back into `feesMinor` failed 2 |
| D2b.1 / D2b.2 plan and cost | 3 `PlanTable.test.jsx` and 3 `debtDetailModel.test.js` cases failed | `PlanTable.test.jsx` 9 (column, days singular and plural, absent without mora, phone cards), `debtDetailModel.test.js` 35 (`cost.lateMinor` 1,375, total plus 1,375 against the no-policy twin, paid mora counted once settled) | Mutation: Mora column forced off failed 2. `?? 0` added for a card projection, which has no `remainingLateInterest` yet |
| D2b.1 / D2b.2 detail | 4 `DebtDetail.test.jsx` cases failed (+1 `DebtDetailContainer.test.jsx`, +1 `DebtsContainer.test.jsx` for Ajustes) | `DebtDetail.test.jsx` 22 incl. 8 new: figure, cost, call-out wording, stale with link, unknown with link, mortgage Ley 546 (with and without a known cap), no notice with a current cap or without a handler, history line | Mutation: the Ajustes link removed failed 2 |
| D2c.1 / D2c.2 model | `latePolicyModel.test.js` failed at import | 20 tests: golden 1,375 on 10 days, effective today 0, a future date measured on its own date, grace 3 gives 962, fixed 20% gives 997, fixed 36% capped to 1,375, multiples 1 and 1.5 give 1,176 and 1,375, off previews against the policy in force, unchanged, issues (missing is silent), stale from the lookup even when nothing is overdue, unknown, `describeLate` | Mutation: measuring on today instead of the later date failed 1 |
| D2c.1 / D2c.2 dialog and container | `LatePolicyDialog.test.jsx` failed at import; 6 container cases failed (no menu item) | `LatePolicyDialog.test.jsx` 14 and 6 container cases: menu order, one `late_policy` event with no cost row, reload then reconcile on fresh events with the row note, double tap writes one, retry reuses the nonce, an edited form after a lost response finds the saved event and writes nothing | One test expectation corrected: turning mora off effective today keeps the accrued 1,375 (never retroactive); it drops to 0 only when dated on the due date |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run src/features/debts` exit 0: 39 files, 520 tests passed (baseline before D2: 36 files, 433). Full `npm test -- --maxWorkers=4`: 122 files, 1,905 tests passed on the first run (baseline before D2: 119 files, 1,818) |
| Runtime harness command/scenario and exact result | The container tests drive the real dialogs, `useCommitDialog`, `planCommit`/`commitPlan` and `previewChange` against a fake debt port: a late_policy save, a double tap, a retry with the same nonce, a mora payment. `npm run build` exit 0. `package:nia` is not part of this slice |
| Rollback boundary | Revert d8bcb8b (dialog, model, container wiring), then 739fdad (detail, plan table, cost, payment and notices; `onNavigate` plumbing), then 5599c78 (wizard mora step and `LateFields`). Reverting only the wizard commit would remove `LateFields`, which the dialog imports, so revert d8bcb8b first. No stored data depends on them: `late_policy` events and `terms.late` are read by the core from A1/C3 on |

### Decisions and deviations from design

- The wizard offers `none`, `usury` and `fixed` only. The design table says `contract_multiple` is offered in "Configurar mora" and Nia, not in the wizard; the batch summary listed it for the wizard, the design was followed. `LateFields` takes a `modes` list, so adding it later is one prop.
- The wizard writes `terms.late` only when the mode is not `none` (an absent policy is `none`, so a family loan is stored exactly as before). Informal debts have no plan step and therefore no mora control; they and cards (default `usury` per LI2, owned by F3b with the card mora engine) get no `terms.late` from D2. Existing debts are untouched.
- "Configurar mora" is offered to loans only. Card wiring stays in F3 (the existing card menu test still lists two items).
- The Save button of the dialog is disabled when the chosen policy equals the one in force (the dialog says so), instead of writing a no-op event as the rate dialog allows.
- The stale/unknown notices in the dialog come from the `previewChange` notices plus a direct `lateEAOn` lookup on the measured day, so the stale cap shows even when nothing is overdue yet (the design only names `after.notices`, which carry it only after some mora accrued). Both cap notices on the detail link to Ajustes (the design links the stale one); the link needs `onOpenSettings`, wired from `FinanceShell` through `DebtsContainer.onNavigate`.
- The Total column of the plan table now shows installment plus mora; the Mora cell shows `N días · base $X`. The overdue call-out gains ", con $X de mora" only when mora is above 0.
- `PaymentDialog` splits "Intereses de mora" from "Cargos e impuestos" (`feesMinor` no longer includes the mora). The cost expense (192,251) is unchanged, it comes from the core.
- `eventSummary.js` and `MoreActionsMenu.jsx` are in the task text but needed no change (already shipped in B1/B2/C3); the tests that cover them were added to the detail and container suites.

### Remaining

D2.0 (owner gate: confirm A1 deployed on web and Nia, then merge D2). F2 (needs A1 deployed on Nia) and F3 are not started.

## Batch F2 (Nia mora: `late_policy` action, default mora by kind, mora lines in replies): COMPLETE, DEPLOY HELD (owner gate F2.0 open)

Branch `feat/dpc-f2-nia-mora` (from `feat/dpc-d2-mora-ui` aee5ba1). No live Appwrite, Gemini or Telegram was touched; `.env` was never read. Mode: Strict TDD, artifact store hybrid (Engram not available: this file and `tasks.md` carry the record).

### Owner gate (F2.0, left unchecked)

F2 is implemented on its branch but MUST NOT be merged or deployed until the owner confirms F2.0: a Nia tarball at or after A1 (the forward-compatible reader) is deployed first. This build can write `late_policy` events and a default `terms.late` on debts created from Nia; an older Nia would mark such debts unreadable. F3 is not started.

### Tasks

- [ ] F2.0 GATE (owner): open, see above
- [x] F2.1 RED `extract.test.js`, `late.test.js` (new), `handler.test.js`, `preview.test.js`, `replies.test.js`, `replies.advice.test.js`, `index.test.js`: "activa mora a la usura" previews mode `usury`, today, the cap in force and "La mora no es retroactiva"; Confirm writes one `late_policy`; fixed 40% against the 28.59 cap states that 28.59 applies; all four modes including `contract_multiple`; creating a debt applies the default by kind; list, payment preview, simulate and advise show the mora; double Confirm leaves one event. Reqs NI4, NI6, NI8, LI2.
- [x] F2.2 GREEN `extract.js` (`late{mode, rate, multiple, graceDays, effectiveOn}`), new `late.js` (preview and reply), `handler.js` (`late_policy` action, callbacks, commit), `preview.js` (default by kind, mora lines in the payment preview), `replies.js` (list, simulate, advise), `pending.js` (type doc), `index.js` (classifier text)
- [x] F2.CP checkpoint

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| 80500ae `feat(nia): extract and preview a mora policy change with the cap in force, the capped rate and the not-retroactive note` | F2a | 4 files, 364 insertions, 3 deletions |
| 5e58656 `feat(nia): configure the mora from Telegram with one late_policy event per confirmation, and give new debts the default mora by kind` | F2b | 5 files, 320 insertions, 6 deletions |
| 2e0bc3f `feat(nia): show the accrued mora in payment previews, the debt list, simulations and advice, and route mora requests through the classifier` | F2c | 9 files, 188 insertions, 12 deletions |

Total vs `feat/dpc-d2-mora-ui` before this progress/tasks commit: 14 files, 872 insertions, 21 deletions = 893 changed lines (budget 2,000; each commit <= 800: F2a is 367, F2b is 326, F2c is 200; design 450, worst case 900).

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR / mutation |
|---|---|---|---|
| F2.1 / F2.2 extraction | 8 `extract.test.js` cases failed (no `latePolicy`, no `late_policy` action, prompt silent) | 57 tests in the file: four modes each with only their own field, date and grace defaults, missing mode, rate and multiple, a fixed rate with no convention kept aside as `rateValue`, multiple 0 and 4, grace 91 and 2.5 and a zero fixed rate as problems, prompt teaches `late_policy` | `late.mode` is a different object from `planChange.mode` (keep_term / keep_installment), so the name clash flagged in the brief does not occur; the normalized result field is `latePolicy` |
| F2.1 / F2.2 preview | `late.test.js` failed at import (module absent) | 14 tests: golden 1,375 on 10 days at the 28.59 cap, effective today 0, fixed 40% against the cap says 28.59 applies, fixed 20% gives 997 with no cap warning, multiples 1 and 1.5 (24% and 36% capped), grace days, off keeps the accrued mora (1,375 against 687), already in force, stale cap, unknown cap, mortgage Ley 546, backdated cost note, card and unreadable refused, the reply after Confirm | The two branches that printed the "Mora acumulada" line were merged into one |
| F2.1 / F2.2 handler | 18 new handler cases failed (the `late_policy (F2)` suite plus the 2 create defaults) | Preview writes nothing; Confirm writes one event with `de{id}`, `debt:{id}` and the done marker; double tap, retry and race leave one; dedupe checked before the rebuild (survives a deleted debt); rebuild from the live debt (a payment after the preview leaves 3 of mora instead of 1,375); four modes; convention buttons for a fixed rate; missing mode, rate and multiple; multiple 5 and grace 120 corrected; card refused; pick between debts; stale `nia:mode` button ignored | `CONVENTION_NEXT.late_policy` joins the existing map instead of a second callback path |
| F2.1 / F2.2 create default | 2 `preview.test.js` and 2 handler cases failed | Bank kinds (consumer, vehicle, libranza, leasing, mortgage) write `late` `{mode: 'usury', graceDays: 0}`; family, other and informal write nothing (the web D2a rule); the create preview names the mora only when it is on | Two older assertions of `not.toContain('usura')` became `not.toContain('tope de usura')`: the new mora line says "usura", the cap notice is what they guard |
| F2.1 / F2.2 pay, list, simulate, advise | 3 `preview.test.js`, 1 `replies.test.js`, 3 `replies.advice.test.js` and 4 handler cases failed | "Mora" and "Mora pendiente" lines in the payment preview (full payment 1,375; a 1,000 payment leaves 375), `mora $ 1.375` in the list, "Mora acumulada hoy" in simulate and advise; the paraphrase receives `lateInterest` as text, the guard allows that figure and still rejects an invented one (9.999) | `debtSummaries` also carries `lateInterestMinor`, so the analysis snapshot sees it |
| F2.1 / F2.2 wiring | 1 `index.test.js` case failed (classifier text had no mora) | Classifier names "configurar la mora"; the entry point previews and a repeated Confirm writes one `late_policy` | none needed |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run functions/nia` exit 0: 13 files, 476 tests passed (baseline before F2: 12 files, 419). Full `npm test -- --maxWorkers=4`: 123 files, 1,962 tests passed on the first run (baseline before F2: 122 files, 1,905) |
| Runtime harness command/scenario and exact result | The `index.test.js` harness drives the real entry point with a fake network: classifier, extraction, preview, `nia:confirm` three times, one `late_policy` row. The handler tests drive the real core `previewChange`, `planCommit` and `commitPlan` against an in-memory port. `npm run build` exit 0. `npm run package:nia` exit 0 (`functions/nia.tar.gz` is untracked) |
| Rollback boundary | Revert 2e0bc3f (mora lines in replies and the classifier text), then 5e58656 (the action and the create default), then 80500ae (extraction and `late.js`). Reverting only 80500ae would break the import in `handler.js`, so revert in order. Nothing in the core, the web or the schema changed |

### Decisions and deviations from design

- The extraction field is `late{mode, rate, multiple, graceDays, effectiveOn}` as designed. The normalized request carries it as `latePolicy: { effectiveOn, late, rateValue? }`, and the pending stores `draft: { effectiveOn, late }` (about 120 bytes; a fixed rate adds one rate object).
- A fixed mora rate with no stated convention reuses the `nia:conv:*` buttons: the pending keeps `rateValue` and `CONVENTION_NEXT.late_policy` completes `late.rate`. The design did not list this path; it follows the spec requirement that the convention callback applies to every action that needs one.
- The pending stores the rate the user asked for (for example 40%), not the capped one. The core caps at accrual time with the table in force on each day, so a later cap update is honoured; the preview says which rate applies today.
- "La mora no es retroactiva" is worded as: mora accrues from the day after the effective date, not for earlier days. A backdated effective date is still accepted (the user chose it) and shows the accrued figure and, when a recorded payment is touched, the web cost-update note.
- Cards are refused politely (at preview and again at Confirm): their mora is part of F3. The default mora on create does not apply to cards because Nia does not create them.
- The create default lives in `buildTerms`, so the preview and the commit agree. Informal debts (balance only) get no mora, like the web wizard.
- The payment preview no longer folds the mora into "Cargos e impuestos": it has its own "Mora" line. The `summary` stored in the pending is unchanged (its `charges` still includes the mora), so the pending size and the cost row are as before.
- The advice mora figure is not in the core `facts`; the handler passes it as an extra (`lateInterest` in the paraphrase prompt, allowed in the numeric guard through its `extra` list) and the deterministic template prints it. The core `advise` was not touched.
- Two earlier `preview.test.js` assertions (`not.toContain('usura')`) were narrowed to `not.toContain('tope de usura')`, see the evidence table.

### Remaining

F2.0 (owner gate: confirm the Nia tarball at or after A1 is deployed, then merge and deploy F2; deploy web and Nia together from C2 on). F3 (card mora and card Nia) is not started.

## Batch F3 (card mora in core and web, "Configurar mora" for cards, restructure guard): COMPLETE (last slice)

Branch `feat/dpc-f3-card-mora` (from `feat/dpc-f2-nia-mora` 0c330d7, itself on the held D2 branch). Nothing was merged or pushed. No live Appwrite, Gemini or Telegram was touched; `.env` was never read. Mode: Strict TDD, artifact store hybrid (Engram not available: this file and `tasks.md` carry the record).

### Tasks

- [x] F3a.1 RED `packages/finance-core/test/card/card.late.test.js` (new, 17 tests, all failing before the code)
- [x] F3a.2 GREEN `card/card.js`, new `card/late.js`, `ledger/events.js`, `ledger/commit.js`, `ledger/preview.js`, `ledger/restructure.js` (shared guard), `ledger/project.js` (`debtKindOf`)
- [x] F3b.1 RED UI tests (17 failing cases across 7 files)
- [x] F3b.2 GREEN `wizardModel.js`, `CardStep.jsx`, `cardModel.js`, `CardDialogs.jsx`, `CardPanel.jsx`, `LatePolicyDialog.jsx`, `DebtDetailContainer.jsx`, `debtDetailModel.js` (comment), `debtFixtures.js` (`makeMoraCard`)
- [x] F3.CP checkpoint: full `npm test -- --maxWorkers=4` 124 files, 1,997 tests passed; `npm run build` exit 0; `npm run package:nia` exit 0. `docs/deploy.md` not changed: no deploy step changes (the card mora rides the same web and Nia bundles as D2 and F2).

### Commits

| Commit | Group | Shortstat |
|---|---|---|
| b069174 `feat(card): accrue mora on the unmet capital of the minimum payment, bill it at the next statement and reject card restructures with a typed error` | F3a | 8 files, 405 insertions, 19 deletions |
| a6b9036 `feat(debts): configure the mora of a card, show it in the card panel and the statement form, and start new cards with the usury mora` | F3b | 16 files, 203 insertions, 19 deletions |

Total vs `feat/dpc-f2-nia-mora` before this progress/tasks commit: 24 files, 608 insertions, 38 deletions = 646 changed lines (budget 2,000; each commit <= 800: F3a is 424, F3b is 222; design 950, worst case 1,900).

### How the card mora works (as built)

- Each closed statement owns one mora item (a pseudo schedule row) that the loan engine `accrueLate` accrues, so the exact accumulator, the single rounding, the cap segments, the grace days and the `late_cap_*` notices are the loan ones. The item starts at the due-date mark and stops at the next statement close.
- Base = `min(shortfall, capital part of the minimum)`, where the capital part is the minimum less that statement's interest, fees, taxes and mora line (payments settle those first). Fixture: minimum 146,102, non-capital 21,102, unmet capital 125,000; 10 days at 28.59 % EA = 861 (exact 861.46). A payment re-reads the base from its date (the day of the payment still counts with the old base); covering the shortfall stops it.
- At the next close the item is billed at its rounded value as the `lateInterest` line of that statement: it goes into the statement total, the contractual minimum, the pay-in-full amount, the balance and `state.accrued.lateInterest` (outside the revolving balance and the interest base, so it accrues nothing more). Payments settle it before interest (allocation order).
- Replacing revolving interest: the base-days of the unmet capital are kept and, at the close, the revolving interest base is reduced by `baseDays / daysInCycle` (the average excluded capital), capped at the base.
- Unbilled mora is visible: plan rows gain `lateInterestMinor` (billed line), `lateMinor`, `lateDays`, `lateBaseMinor`; the projection gains `lateInterestMinor` and `totals.remainingLateInterest` (billed and unpaid plus accrued and not billed). The balance moves only when it is billed.
- `late_policy` is a card handler (the policy applies from the day after its date); `rate_change` also feeds the mora work terms. Mode `none` (or no policy) accrues nothing and the shortfall is still flagged past due.
- `adjustment.lateInterestMinor` (whole pesos, optional) replaces the billed mora of the latest statement; the difference goes to that line (statement total, pay in full, closing) and is reported as `drift`, never absorbed by the revolving balance. A stated balance in the same adjustment still wins. Golden: computed 861, statement 900, drift +39.
- `planCommit` and `previewChange` call `assertRestructurable` (new, in `ledger/restructure.js`) before building a `restructure` draft, throwing `ValidationError('restructure_unsupported')` for a card; a stored card `restructure` is skipped with the notice `{ code: 'card_restructure_ignored', eventId }`.
- Web: "Configurar mora" is wired for cards (the menu lists Cambiar tasa, Cambiar seguros y cargos, Configurar mora; never Reestructurar); the dialog has a card variant (explanation, "Mínimo vencido" row); the statement form has "Mora del extracto (opcional)"; the card panel shows "Mora en curso" and a "Mora" line in the last statement; a new card starts with `late: { mode: 'usury', graceDays: 0 }` and the step says so.

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR / mutation |
|---|---|---|---|
| F3a.1 / F3a.2 accrual and billing | `card.late.test.js` 17 of 17 failed (`lateMinor`, `lateInterestMinor`, notices and the guards did not exist) | 17 tests: golden 861 (exact 861.46) billed at the next close; 431 mid-cycle unbilled with the balance unchanged and 0 on the due date; no growth after the close; covered on day 5 bills 431; a 71,102 partial payment lowers the base (125,000 x 5 + 75,000 x 5); minimum paid gives none and not past due; `none`/absent gives none but past due 146,102; statement total, minimum and pay in full carry the line apart from the revolving balance; grace 3 gives 7 days; a policy effective on day 5 gives 431; no cap gives the contract rate and `late_cap_unknown`; a payment settles the billed 861 first | Mutations killed: the interest exclusion removed (1 failed), `refreshLate` removed from payments (1 failed), the paid-mora bucket zeroed (1 failed). Triangulated with 5-day, 7-day and partial-base cases |
| F3a.1 / F3a.2 override and guards | same file | override 900 shows 900 with drift 39, balance +39 and an unchanged revolving balance; with a stated balance of computed + 39 the revolving balance is untouched; negative and fractional rejected; `restructure` throws `restructure_unsupported` from `planCommit` and `previewChange`; a stored one is skipped with `card_restructure_ignored` and the balance is unchanged; `late_policy` plans and previews on a card (0 to 861) | none needed |
| F3b.1 / F3b.2 wizard and statement | 7 failed (`wizardModel.test.js`, `cardWizardModel.test.js`, `CardWizard.test.jsx`, `cardModel.test.js` x5) | new cards carry usury and `none` drops it; the card step says so and saves `late` in the terms; the statement draft carries `lateInterestMinor` and rejects `abc`, `-5` and `10.5` | none needed |
| F3b.1 / F3b.2 panel, dialog, container | 8 failed (`DebtDetail.card.test.jsx` 2, `LatePolicyDialog.test.jsx` 2, `DebtDetailContainer.card.test.jsx` 4 incl. the menu) | panel: "Mora en curso: $ 861 (se cobra en el corte del 15 may)" on day 10 and "Mora $ 1.292" in the last statement on day 20 (15 days to the close), nothing for a card without mora; dialog: card text, 0 to 861, "Mínimo vencido" row, one `late_policy` draft; container: the card menu lists three items, a saved `late_policy` with no cost row, the statement writes `lateInterestMinor` 1,300 | none needed |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run packages/finance-core` exit 0: 33 files, 576 tests (baseline 32 files, 559). `npx vitest run src/features/debts` exit 0: 39 files, 538 tests (baseline 39 files, 521). Full `npm test -- --maxWorkers=4`: 124 files, 1,997 tests passed (baseline 123 files, 1,962; the `App.test.jsx` "keeps the shell mounted" jsdom timeout showed once on a first full run and passed on the rerun, as known) |
| Runtime harness command/scenario and exact result | The projector tests drive the real `project`, `planCommit` and `previewChange` with an injected cap table; the container tests drive the real dialogs, `useCommitDialog`, `planCommit`/`commitPlan` and `previewChange` against a fake debt port. `npm run build` exit 0. `npm run package:nia` exit 0 (`functions/nia.tar.gz` written; not committed) |
| Rollback boundary | Revert a6b9036 (web: card mora UI, wizard default, statement field), then b069174 (core: `card/late.js`, projector, `adjustment.lateInterestMinor`, restructure guard). Reverting only b069174 would leave the web reading `lateMinor` fields that no longer exist, so revert the web commit first. Stored data is untouched: the new `adjustment` field is dropped by older cores (the normalizer keeps known keys), and `late_policy` events and `terms.late` already exist from D2/F2 |

### Decisions and deviations from design

- Revolving exclusion: the design says the unmet principal is excluded from the revolving interest base. The card interest is a full monthly rate on the balance at the due date (no day count), so the exclusion is prorated by the days the mora ran over the length of the cycle (`baseDays / cycleDays`) and capped at the base. It excludes the whole unmet capital, not only its revolving part (the capital part of a minimum also holds the installment principal that never earned revolving interest); with the fixture and nothing paid this reduces the second statement's interest from 10,392 to 9,526 (125,000 for 10 of 30 days). This is the literal reading of the design; flagging it for verify.
- Mora billed on an overridden statement changes the cycle's total, pay in full and closing by the difference, but not its minimum (the bank's minimum comes from `minimumDueMinor`).
- Unbilled mora is shown in `lateInterestMinor` and the totals but not in the balance (it joins the balance when billed at the close).
- A due date clamped onto the statement day (for example day 30 and 31 in February) is marked right after the close, so its mora starts the next day.
- The tasks do not include the Nia card refusal (`CARD_LATE` in `functions/nia/debt/late.js` and `handler.js`), so it stays: Nia still refuses `late_policy` on a card and says to use the web. Lifting it is a small follow-up (the core, `planCommit` and `previewChange` already support it).
- The card wizard has no mora control (the design only asks for the default); the step carries one sentence and "Más acciones" changes it later. `MoreActionsMenu.jsx` needed no change: it was already generic and only the container wiring was missing.
- `previewChange` and `planCommit` get the card guard through `assertRestructurable` in `ledger/restructure.js` (which already owned the typed error and imports `project.js`), plus `debtKindOf` in `project.js`; none is exported by the package barrel.

### Remaining

Nothing in F3. Owner gates D2.0 and F2.0 are still open (confirm Nia at or after A1 is deployed, then merge and deploy D2, F2 and F3 in order, web and Nia together). Next: `sdd-verify`.

## Follow-up: Nia card mora

Branch `fix/dpc-nia-card-mora` (from master ad9a33f). The F3 deviation list kept the Nia card refusal; the owner requires card mora to be manageable from both the web and Nia, so it is lifted.

### Changes

- `functions/nia/debt/late.js`: `previewLatePolicy` no longer refuses a card. It previews with the card projection (`previewChange` snapshots, `projection.lateInterestMinor`): mode, effective date, cap echo and the mora accrued as of today before and after, plus a note that a card's mora is computed on the unmet capital of the minimum payment and billed at the next statement. `describeLatePolicy` adds that the card's mora is billed at the next statement. `CARD_LATE` removed. Loan output is unchanged.
- `functions/nia/debt/handler.js`: the two card refusals (`continueLate` preview and `commitLatePolicy` confirm) are removed. Confirm still writes one `late_policy` event, deduped by `debt:{pendingId}`.
- `functions/nia/README.md`: added the `late_policy` row (it was missing; the table said nine actions, there are ten) and states that cards are supported.

### TDD Cycle Evidence

| Task | RED | GREEN |
|---|---|---|
| Nia card `late_policy` | `late.test.js` 5 failed (the card refusal replaced by card golden tests) and `handler.test.js` 2 failed (preview and exactly-once Confirm on a card, previously refused) | card golden 125,000 of unmet capital, 10 days at 28.59% EA: "Mora acumulada al 2026-10-20: $ 0 -> $ 861"; one `late_policy` event for a repeated Confirm, then "Esta mora ya estaba registrada"; `npx vitest run functions/nia` all green |
