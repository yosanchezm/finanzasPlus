# Apply progress: debt-plan-changes

Mode: Strict TDD (Vitest, `npm test`). Delivery: auto-chain, stacked-to-main. Branches: `feat/dpc-a1-forward-compat` (A1), `feat/dpc-a2-legal-data` (A2), `feat/dpc-a3-ajustes` (A3), `feat/dpc-b1-preview-change` (B1), `feat/dpc-b2-rate-change` (B2).

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
