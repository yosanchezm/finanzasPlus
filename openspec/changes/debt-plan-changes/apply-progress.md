# Apply progress: debt-plan-changes

Mode: Strict TDD (Vitest, `npm test`). Delivery: auto-chain, stacked-to-main. Branches: `feat/dpc-a1-forward-compat` (A1), `feat/dpc-a2-legal-data` (A2), `feat/dpc-a3-ajustes` (A3).

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

B1 onward (not started).
