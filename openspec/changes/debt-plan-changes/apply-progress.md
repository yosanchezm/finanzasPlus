# Apply progress: debt-plan-changes

Mode: Strict TDD (Vitest, `npm test`). Delivery: auto-chain, stacked-to-main. Branch: `feat/dpc-a1-forward-compat`.

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

A2 onward (not started).
